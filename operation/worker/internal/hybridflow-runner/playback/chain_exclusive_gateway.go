package playback

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"slices"

	"cel.dev/cel-go/cel"
	"cel.dev/cel-go/common/types"

	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	runstate "kiao/worker/internal/hybridflow-runner/playback/state"
)

func (r *ChainRunner) playExclusiveGateway(
	ctx context.Context, run *ChainRun, node pkgBoards.FlowNode, values pkgBoards.NodeContext, out PlayOneOutcome,
) PlayOneOutcome {
	out.Round = roundStop
	if node.Type != pkgBoards.FlowNodeTypeExclusiveGateway || node.Archived {
		r.say(run, runstate.NoticeWarning, fmt.Sprintf("“%s” changed while it was being started; the play stops here.", out.Title))
		return out
	}
	next, err := selectRoute(ctx, values, node)
	if r.stopping(run) || ctx.Err() != nil {
		return out
	}
	if err != nil {
		message := fmt.Sprintf("“%s” could not choose a route: %s.", node.Title, err)
		r.LogNote(run, node.ID, "", "", message)
		r.say(run, runstate.NoticeError, message)
		r.fail(run, node.ID)
		return out
	}
	out.nextID = next
	return r.completeAutomatic(run, node.ID, values.Input, out)
}

func selectRoute(ctx context.Context, values pkgBoards.NodeContext, node pkgBoards.FlowNode) (string, error) {
	if len(node.OnSuccess.FlowNodes) == 1 && len(node.Routes) == 0 {
		return node.OnSuccess.FlowNodes[0], nil
	}
	if len(values.Input) == 0 && values.Workflow == nil && len(values.Roles) == 0 {
		return "", fmt.Errorf("the predecessor has no successful JSON output")
	}
	variables := map[string]any{"role": values.Roles}
	if len(values.Input) > 0 {
		value, err := decodeRouteValue(values.Input)
		if err != nil {
			return "", fmt.Errorf("the predecessor output is invalid JSON: %w", err)
		}
		variables["input"] = value
	}
	if values.Workflow != nil {
		raw, err := json.Marshal(values.Workflow.Context())
		if err != nil {
			return "", err
		}
		value, err := decodeRouteValue(raw)
		if err != nil {
			return "", err
		}
		variables["currentWokflow"], variables["currentWorkflow"] = value, value
	}
	env, err := cel.NewEnv(cel.Variable("input", cel.DynType),
		cel.Variable("currentWokflow", cel.DynType), cel.Variable("currentWorkflow", cel.DynType),
		cel.Variable("role", cel.MapType(cel.StringType, cel.StringType)))
	if err != nil {
		return "", err
	}
	for i, route := range node.Routes {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		matches, err := matchRoute(ctx, env, route.Condition, variables)
		if err != nil {
			return "", fmt.Errorf("route %d: %w", i+1, err)
		}
		if matches {
			if !slices.Contains(node.OnSuccess.FlowNodes, route.FlowNode) || route.FlowNode == "" {
				return "", fmt.Errorf("route %d must name a linked successor", i+1)
			}
			return route.FlowNode, nil
		}
	}
	return "", fmt.Errorf("no route condition matched")
}

func decodeRouteValue(raw json.RawMessage) (any, error) {
	if !json.Valid(raw) {
		return nil, fmt.Errorf("expected a JSON value")
	}
	var value any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	err := decoder.Decode(&value)
	return value, err
}

func matchRoute(ctx context.Context, env *cel.Env, condition string, variables map[string]any) (bool, error) {
	ast, issues := env.Compile(condition)
	if err := issues.Err(); err != nil {
		return false, err
	}
	program, err := env.Program(ast, cel.CostLimit(1_000_000), cel.InterruptCheckFrequency(100))
	if err != nil {
		return false, err
	}
	result, _, err := program.ContextEval(ctx, variables)
	if err != nil {
		return false, err
	}
	matched, ok := result.(types.Bool)
	if !ok {
		return false, fmt.Errorf("the condition must return a boolean")
	}
	return bool(matched), nil
}
