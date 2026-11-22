package postgres

import (
	"context"
	"encoding/json"
	"regexp"
	"strconv"

	"github.com/jackc/pgx/v5/pgxpool"
	"kiao/hybridflow-store/core/entities"
)

type ExecutionStore struct{ pool *pgxpool.Pool }

var executionReleaseTag = regexp.MustCompile(`^v[0-9]+\.[0-9]+\.[0-9]+$`)

func NewExecutionStore(pool *pgxpool.Pool) *ExecutionStore { return &ExecutionStore{pool: pool} }
func (s *ExecutionStore) RecordExecution(ctx context.Context, execution entities.TaskExecution) error {
	configuration, err := json.Marshal(execution.Agent)
	if err != nil {
		return err
	}
	tag, err := s.pool.Exec(ctx, `INSERT INTO task_execution(id,flow_node_id,conversation_id,turn_id,runner_id,run_id,harness,model,effort,agent_id,agent_repository,agent_commit,configuration,at)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(id) DO NOTHING`, execution.ID, execution.FlowNodeID, execution.ConversationID, execution.TurnID, execution.RunnerID, execution.RunID, execution.Harness, execution.Model, execution.Effort, execution.Agent.AgentID, execution.Agent.Repository, execution.Agent.Commit, configuration, execution.At)
	if err != nil {
		return translate(err, "task execution")
	}
	if tag.RowsAffected() == 1 {
		return nil
	}
	var same bool
	err = s.pool.QueryRow(ctx, `SELECT flow_node_id::text=$2 AND conversation_id=$3 AND turn_id=$4 AND runner_id=$5 AND run_id=$6 AND harness=$7 AND model=$8 AND effort=$9 AND configuration=$10::jsonb AND at=$11 FROM task_execution WHERE id=$1`, execution.ID, execution.FlowNodeID, execution.ConversationID, execution.TurnID, execution.RunnerID, execution.RunID, execution.Harness, execution.Model, execution.Effort, configuration, execution.At).Scan(&same)
	if err != nil {
		return translate(err, "task execution")
	}
	if !same {
		return entities.Conflictf("execution %s already records a different configuration", execution.ID)
	}
	return nil
}
func (s *ExecutionStore) Executions(ctx context.Context, id string) ([]entities.TaskExecution, error) {
	rows, err := s.pool.Query(ctx, `SELECT id,flow_node_id::text,conversation_id,turn_id,runner_id,run_id,harness,model,effort,configuration,at FROM task_execution WHERE flow_node_id::text=$1 ORDER BY at,id`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []entities.TaskExecution{}
	for rows.Next() {
		var e entities.TaskExecution
		var data []byte
		if err = rows.Scan(&e.ID, &e.FlowNodeID, &e.ConversationID, &e.TurnID, &e.RunnerID, &e.RunID, &e.Harness, &e.Model, &e.Effort, &data, &e.At); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(data, &e.Agent); err != nil {
			return nil, err
		}
		if len(e.Agent.Version) == 0 || e.Agent.Version[0] != '"' {
			e.Agent.Version = nil
			if executionReleaseTag.MatchString(e.Agent.Tag) {
				e.Agent.Version = json.RawMessage(strconv.Quote(e.Agent.Tag[1:]))
			}
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
