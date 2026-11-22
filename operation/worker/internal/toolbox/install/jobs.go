package install

import (
	"fmt"
	"io"
	idgen "kiao/worker/internal/core/ids"
	toolfaults "kiao/worker/internal/toolbox/faults"
	"kiao/worker/internal/toolbox/inventory"
	"strings"
	"sync"
	"time"
)

// maxLogBytes bounds one job's log. A pip resolution can be thousands of lines; the panel shows a
// scrolling pane and the oldest lines are the least useful, so the log keeps its tail.
const maxLogBytes = 256 << 10

// jobLog is the growing text of one job, written by the driver goroutine and read by every poll.
type jobLog struct {
	mu   sync.Mutex
	text strings.Builder
	// echo, when set, mirrors every line as it is written. The service leaves it nil, because the
	// panel polls the text; `worker toolbox preinstall` (cli.go) sets it to stderr, because
	// a build script's user watches a 300 MB download rather than polling anything.
	echo io.Writer
}

func (l *jobLog) print(s string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.echo != nil {
		fmt.Fprintln(l.echo, s)
	}
	l.text.WriteString(s)
	l.text.WriteByte('\n')
	if l.text.Len() > maxLogBytes {
		// Rebuild from the tail, on a line boundary, so the pane never shows half a line.
		kept := l.text.String()[l.text.Len()-maxLogBytes:]
		if _, rest, ok := strings.Cut(kept, "\n"); ok {
			kept = rest
		}
		l.text.Reset()
		l.text.WriteString("… earlier output dropped …\n")
		l.text.WriteString(kept)
	}
}

func (l *jobLog) printf(format string, args ...any) { l.print(fmt.Sprintf(format, args...)) }

func (l *jobLog) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.text.String()
}

// job is one install or uninstall run. There is at most one, and it is kept after it ends so the
// panel can show what happened — until the next one replaces it.
type job struct {
	id  string
	op  string
	ids []string
	log *jobLog

	mu        sync.Mutex
	state     string
	err       string
	startedAt string
	endedAt   string
}

func newJob(op string, ids []string) *job {
	return &job{
		id:        "job-" + idgen.NowMillisStr() + "-" + idgen.RandID(),
		op:        op,
		ids:       ids,
		log:       &jobLog{},
		state:     JobRunning,
		startedAt: inventory.Stamp(),
	}
}

// finish settles the job. A nil error is a success; anything else is reported on the row and in the
// log, which by then already holds the command that produced it.
func (j *job) finish(err error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.endedAt = inventory.Stamp()
	if err != nil {
		j.state, j.err = JobFailed, err.Error()
		return
	}
	j.state = JobDone
}

func (j *job) running() bool {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.state == JobRunning
}

func (j *job) dto() *ToolboxJobDto {
	j.mu.Lock()
	defer j.mu.Unlock()
	return &ToolboxJobDto{
		ID:        j.id,
		Op:        j.op,
		IDs:       j.ids,
		State:     j.state,
		Log:       j.log.String(),
		Error:     j.err,
		StartedAt: j.startedAt,
		EndedAt:   j.endedAt,
	}
}

// runner holds the one job slot. Start refuses a second while one runs rather than queueing: a
// panel that has just been told "an install is already running" is a panel whose user can see what
// is running, which is more use than a queue nobody can inspect.
type runner struct {
	mu      sync.Mutex
	current *job
}

// start claims the slot and runs work on a goroutine of its own. The returned job is the one to
// poll; the error is the refusal when the slot is taken.
func (r *runner) start(op string, ids []string, work func(*jobLog) error) (*job, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.current != nil && r.current.running() {
		return nil, toolfaults.ErrJobRunning
	}
	j := newJob(op, ids)
	r.current = j
	go func() {
		started := time.Now()
		inventory.LogInstall.Info("toolbox job started", "job", j.id, "op", op, "components", ids)
		err := work(j.log)
		j.finish(err)
		if err != nil {
			j.log.printf("failed: %v", err)
			inventory.LogInstall.Error("toolbox job failed", "job", j.id, "op", op,
				"components", ids, "duration", time.Since(started), "error", err)
			return
		}
		j.log.print("done")
		inventory.LogInstall.Info("toolbox job finished", "job", j.id, "op", op,
			"components", ids, "duration", time.Since(started))
	}()
	return j, nil
}

// get answers the job with this id, which is only ever the one in hand: a panel polls the job it
// started, and a job replaced by the next one is no longer anybody's business.
func (r *runner) get(id string) (*job, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.current == nil || r.current.id != id {
		return nil, false
	}
	return r.current, true
}

// latest answers the job in flight, or the last one to have ended, or nil.
func (r *runner) latest() *job {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.current
}

// busy reports whether a job holds the slot right now — read by the panel so it can disable its
// buttons rather than let a click become a 400.
func (r *runner) busy() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.current != nil && r.current.running()
}
