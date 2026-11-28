package mcp

import (
	"bytes"
	"fmt"
	"io"
	"kiao/worker/internal/core/equipment"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"
)

const stderrLimit = 4096

type stdioProcess struct {
	input  io.WriteCloser
	output *os.File
	stderr tailBuffer
	done   chan struct{}
	cmd    *exec.Cmd
	exit   error
}

func startStdio(server equipment.MCPServer, dir string) (*stdioProcess, error) {
	child := &stdioProcess{done: make(chan struct{})}
	cmd := exec.Command(server.Command, server.Args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), environmentEntries(server.Env)...)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Stderr = &child.stderr
	cmd.WaitDelay = time.Second
	input, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	// Keep our read end open after Wait so the final replies can be drained.
	output, writer, err := os.Pipe()
	if err != nil {
		input.Close()
		return nil, err
	}
	defer writer.Close()
	cmd.Stdout = writer
	if err := cmd.Start(); err != nil {
		input.Close()
		output.Close()
		return nil, err
	}
	child.input, child.output, child.cmd = input, output, cmd
	go func() {
		child.exit = cmd.Wait()
		// A launcher may exit while a child still holds the pipes.
		child.kill()
		_ = output.SetReadDeadline(time.Now().Add(time.Second))
		close(child.done)
	}()
	return child, nil
}

func (p *stdioProcess) kill() {
	_ = syscall.Kill(-p.cmd.Process.Pid, syscall.SIGKILL)
}

func (p *stdioProcess) close() {
	select {
	case <-p.done:
	default:
		p.kill()
		<-p.done
	}
	_ = p.output.Close()
}

func (p *stdioProcess) explain(err error, reportSignal bool) error {
	if p.exit != nil && (reportSignal || p.cmd.ProcessState.ExitCode() > 0) {
		err = fmt.Errorf("%w (%v)", err, p.exit)
	}
	if detail := strings.TrimSpace(string(p.stderr)); detail != "" {
		err = fmt.Errorf("%w\n%s", err, detail)
	}
	return err
}

type tailBuffer []byte

func (b *tailBuffer) Write(p []byte) (int, error) {
	n := len(p)
	p = p[max(0, n-stderrLimit):]
	overflow := max(0, len(*b)+len(p)-stderrLimit)
	*b = append((*b)[:copy(*b, (*b)[overflow:])], p...)
	return n, nil
}

func environmentEntries(values map[string]string) []string {
	entries := make([]string, 0, len(values))
	for key, value := range values {
		entries = append(entries, key+"="+value)
	}
	return entries
}

func writeFrame(w io.Writer, frame []byte) error {
	_, err := w.Write(append(bytes.TrimRight(frame, "\r\n"), '\n'))
	return err
}
