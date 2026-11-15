package muse

import (
	"encoding/json"
	"os"
	"time"
)

// museStubLog is one request the stub received: the method and its params verbatim.
type museStubLog struct {
	Method string         `json:"method"`
	Params map[string]any `json:"params"`
}

func museStubMain() int {
	// A stub that outlives its test is a failure's ghost: never more than a minute, whatever the
	// test forgot to end.
	time.AfterFunc(time.Minute, func() { os.Exit(1) })

	script := os.Getenv("MUSE_STUB_SCRIPT")
	logPath := os.Getenv("MUSE_STUB_LOG")
	logFile, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return 1
	}
	defer logFile.Close()
	record := func(method string, params map[string]any) {
		line, _ := json.Marshal(museStubLog{Method: method, Params: params})
		logFile.Write(append(line, '\n'))
	}
	record("env", map[string]any{"XDG_CONFIG_HOME": os.Getenv("XDG_CONFIG_HOME")})
	// What the host was pointed at: a staged turn carries its servers and its token here, and a
	// test asserting on it has to read it through the stub — the staging is gone by the time the
	// turn ends.
	if configHome := os.Getenv("XDG_CONFIG_HOME"); configHome != "" {
		if settings, err := os.ReadFile(configHome + "/muse/settings.json"); err == nil {
			record("settings", map[string]any{"content": string(settings)})
		} else {
			record("settings", map[string]any{"missing": err.Error()})
		}
	}

	in := json.NewDecoder(os.Stdin)
	out := json.NewEncoder(os.Stdout)
	answer := func(id any, result any) {
		_ = out.Encode(map[string]any{"jsonrpc": "2.0", "id": id, "result": result})
	}
	fail := func(id any, message string) {
		_ = out.Encode(map[string]any{"jsonrpc": "2.0", "id": id,
			"error": map[string]any{"code": -32000, "message": message,
				"data": map[string]any{"kind": "stubRefused"}}})
	}
	notify := func(method string, params map[string]any) {
		_ = out.Encode(map[string]any{"jsonrpc": "2.0", "method": method, "params": params})
	}

	turnID := ""
	starts := 0
	pages := 0
	awaiting := ""
	emitTurn := func() {
		notify("item/completed", map[string]any{
			"sessionId": "ses-1",
			"item": map[string]any{"kind": "agentMessage", "itemId": "item-1",
				"turnId": turnID, "text": "hello from stub"},
		})
		notify("turn/completed", map[string]any{
			"sessionId": "ses-1", "turnId": turnID, "terminal": "completed",
		})
	}
	for {
		var frame struct {
			ID     *int           `json:"id"`
			Method string         `json:"method"`
			Params map[string]any `json:"params"`
		}
		if err := in.Decode(&frame); err != nil {
			return 0 // stdin closed: the turn is over
		}
		if frame.ID == nil {
			continue // a notification of the client's own (the handshake's `initialized`)
		}
		id := *frame.ID
		if frame.Params == nil {
			frame.Params = map[string]any{}
		}
		record(frame.Method, frame.Params)
		switch frame.Method {
		case "initialize":
			answer(id, map[string]any{"serverInfo": map[string]any{"name": "stub"}})
		case "model/list":
			answer(id, map[string]any{"models": []any{
				map[string]any{"modelId": "stub-model", "displayLabel": "Stub"},
			}})
		case "session/start":
			answer(id, map[string]any{
				"session": map[string]any{"sessionId": "ses-1"}, "viewCursor": ""})
		case "session/resume":
			if script == "resume-fail" {
				fail(id, "session not found")
				continue
			}
			answer(id, map[string]any{
				"session": map[string]any{
					"sessionId": frame.Params["sessionId"]},
				"history": map[string]any{}, "pendingRequests": []any{},
				"viewCursor": ""})
		case "session/fork":
			if script == "fork-no-birth-time" {
				fail(id, "internal error: resolve branch creation time: "+
					"file birth time is unavailable: creation time is not available on this harness currently")
				continue
			}
			answer(id, map[string]any{
				"session": map[string]any{"sessionId": "ses-fork"},
				"history": map[string]any{}, "pendingRequests": []any{},
				"viewCursor": ""})
		case "session/setModel", "session/setApprovalMode":
			answer(id, map[string]any{
				"commandId": frame.Params["commandId"], "status": "accepted"})
		case "session/compact":
			if script == "compact-noop" {
				answer(id, map[string]any{
					"commandId": frame.Params["commandId"], "status": "noop",
					"reason": "no_compactable_history"})
				continue
			}
			answer(id, map[string]any{
				"commandId": frame.Params["commandId"], "status": "accepted"})
			notify("item/completed", map[string]any{
				"sessionId": "ses-1",
				"item":      map[string]any{"kind": "compaction", "itemId": "item-c"},
			})
		case "turn/start":
			turnID, _ = frame.Params["commandId"].(string)
			starts++
			answer(id, map[string]any{"commandId": frame.Params["commandId"],
				"disposition": "started", "startedNewTurn": true,
				"status": "accepted", "turnId": turnID})
			switch script {
			case "ask":
				awaiting = "decide"
				notify("approval/requested", map[string]any{
					"sessionId": "ses-1", "turnId": turnID, "approvalId": "apv-1",
					"toolName": "shell", "toolCallId": "call-1", "itemId": "item-1",
					"currentRequirementId": map[string]any{
						"approvalId": "apv-1", "sourceIndex": 0},
					"availableChoices": []any{
						map[string]any{"choiceId": "allow-once",
							"decision": "approved", "scope": "once", "label": "Yes"},
						map[string]any{"choiceId": "allow-session",
							"decision": "approved", "scope": "session", "label": "Always"},
						map[string]any{"choiceId": "deny",
							"decision": "denied", "scope": "once",
							"label": "No", "acceptsFeedback": true},
					},
					"subject": map[string]any{"kind": "shell", "command": "ls /tmp"},
					"rawArgs": `{"command":"ls /tmp"}`, "viewCursor": "v1",
				})
			case "ask-external":
				notify("approval/requested", map[string]any{
					"sessionId": "ses-1", "turnId": turnID, "approvalId": "apv-9",
					"toolName": "shell",
					"currentRequirementId": map[string]any{
						"approvalId": "apv-9", "sourceIndex": 0},
					"availableChoices": []any{},
					"subject":          map[string]any{"kind": "shell", "command": "ls"},
					"rawArgs":          `{"command":"ls"}`, "viewCursor": "v1",
				})
				notify("approval/resolved", map[string]any{
					"sessionId": "ses-1", "turnId": turnID, "approvalId": "apv-9",
					"decision": "approved", "decidedByCommandId": "cmd-foreign",
				})
				notify("turn/completed", map[string]any{
					"sessionId": "ses-1", "turnId": turnID, "terminal": "completed",
				})
			case "question":
				awaiting = "answer"
				notify("userInput/requested", map[string]any{
					"sessionId": "ses-1", "turnId": turnID, "userInputId": "u-1",
					"toolName": "request_user_input", "toolCallId": "call-2",
					"itemId":     "item-2",
					"viewCursor": "v1",
					"questions": []any{
						map[string]any{"id": "q1", "header": "Colour",
							"question":  "First?",
							"selection": map[string]any{"mode": "single"},
							"options": []any{
								map[string]any{"label": "Red"},
								map[string]any{"label": "Blue", "description": "the sad one"},
							}},
						map[string]any{"id": "q2", "header": "Letters",
							"question":  "Pick?",
							"selection": map[string]any{"mode": "multiple"},
							"options": []any{
								map[string]any{"label": "A"},
								map[string]any{"label": "B"},
								map[string]any{"label": "C"},
							}},
					},
				})
			case "steer":
				awaiting = "steer"
			case "fail":
				notify("item/completed", map[string]any{
					"sessionId": "ses-1",
					"item": map[string]any{"kind": "agentMessage", "itemId": "item-1",
						"turnId": turnID, "text": "partial"},
				})
				notify("turn/completed", map[string]any{
					"sessionId": "ses-1", "turnId": turnID, "terminal": "failed",
					"error": map[string]any{"kind": "kebab", "message": "boom",
						"retryable": false},
				})
			case "blocks":
				notify("item/completed", map[string]any{
					"sessionId": "ses-1",
					"item": map[string]any{"kind": "reasoning", "itemId": "item-1",
						"turnId": turnID, "summary": []any{"s1", "s2"}},
				})
				notify("item/completed", map[string]any{
					"sessionId": "ses-1",
					"item": map[string]any{"kind": "toolCall", "itemId": "item-2",
						"turnId": turnID, "tool": "Read", "args": `{"file":"x"}`},
				})
				notify("item/completed", map[string]any{
					"sessionId": "ses-1",
					"item": map[string]any{"kind": "userMessage", "itemId": "item-3",
						"turnId": turnID, "text": "the echo"},
				})
				notify("item/completed", map[string]any{
					"sessionId": "ses-1",
					"item": map[string]any{"kind": "subagent", "itemId": "item-4",
						"turnId": turnID, "fallbackText": "child did things"},
				})
				notify("item/completed", map[string]any{
					"sessionId": "ses-1",
					"item": map[string]any{"kind": "agentMessage", "itemId": "item-5",
						"turnId": turnID, "text": "tail"},
				})
				notify("turn/completed", map[string]any{
					"sessionId": "ses-1", "turnId": turnID, "terminal": "completed",
				})
			case "subagent", "subagent-fail":
				// One delegation, naming its child's own session: the driver reads that
				// session back and files what the child thought and did beneath the
				// parent's line. The fail script's read is refused, and the line alone
				// is what is filed.
				notify("item/completed", map[string]any{
					"sessionId": "ses-1",
					"item": map[string]any{"kind": "subagent", "itemId": "item-4",
						"turnId": turnID, "fallbackText": "child did things",
						"subagentId": "sub-1", "childSessionId": "ses-child",
						"role": "researcher", "objective": "find the bug",
						"status": "completed",
						"result": map[string]any{"summary": "it was the cache"}},
				})
				notify("turn/completed", map[string]any{
					"sessionId": "ses-1", "turnId": turnID, "terminal": "completed",
				})
			case "cancel":
				// Nothing: the test stops the turn, and the kill ends the stream.
			case "silent":
				// Nothing at all: no items, no end. The idle wait is what ends the turn.
			case "silent-then-blocks", "usage-then-resume":
				// The first turn blocks; the resume after it answers like a plain turn.
				if script == "usage-then-resume" {
					notify("session/tokenUsage", map[string]any{"turnId": turnID, "usage": map[string]any{
						"inputTokens": starts * 100, "outputTokens": starts * 10,
					}})
				}
				if starts > 1 {
					emitTurn()
				}
			case "resync-end":
				// Silent throughout: the resync's page carries the turn's end, so no
				// resume ever starts.
			case "resync-notloaded":
				// Silent throughout: the session reads as unloaded, which concludes
				// nothing — the blockage runs its course to the resume and the fork.
			case "ask-then-silent":
				// One live approval, then silence past the decision: the settlement
				// never arrives, so the resync finds the turn parked on an ask the
				// hub already holds.
				notify("approval/requested", map[string]any{
					"sessionId": "ses-1", "turnId": turnID, "approvalId": "apv-1",
					"toolName": "shell", "toolCallId": "call-1", "itemId": "item-1",
					"currentRequirementId": map[string]any{
						"approvalId": "apv-1", "sourceIndex": 0},
					"availableChoices": []any{
						map[string]any{"choiceId": "allow-once",
							"decision": "approved", "scope": "once", "label": "Yes"},
						map[string]any{"choiceId": "deny",
							"decision": "denied", "scope": "once",
							"label": "No", "acceptsFeedback": true},
					},
					"subject": map[string]any{"kind": "shell", "command": "ls /tmp"},
					"rawArgs": `{"command":"ls /tmp"}`, "viewCursor": "v1",
				})
			case "resync-parked":
				// Silent until resumed: the resync finds the blind park first, waits
				// on, and only the blockage after it resumes into an answering turn.
				if starts > 1 {
					emitTurn()
				}
			case "view-down":
				// The live view dies mid-turn, then the turn answers over the dead
				// stream like nothing happened.
				notify("session/viewHealthChanged", map[string]any{
					"sessionId": "ses-1", "health": "unavailable",
				})
				emitTurn()
			case "unqueued":
				// Nothing runs and nothing completes: per the schema no turn/started and no
				// turn/completed is ever emitted for the reclaimed turn.
				notify("turn/unqueued", map[string]any{
					"sessionId": "ses-1", "turnId": turnID,
					"commandId": frame.Params["commandId"],
				})
			case "drain", "drain-stuck", "drain-stale":
				// One background workflow still running when the turn ends: the
				// driver waits for its completion instead of killing the host
				// with the turn. What the reconcile finds, and whether the run
				// ever lands, is per script — see the session/read arms below.
				notify("item/started", map[string]any{
					"sessionId": "ses-1", "viewCursor": "v1",
					"item": map[string]any{"kind": "workflow", "itemId": "item-wf",
						"turnId": turnID, "status": "inProgress", "revision": 1,
						"entryId": "inventory"},
				})
				notify("item/completed", map[string]any{
					"sessionId": "ses-1", "viewCursor": "v2",
					"item": map[string]any{"kind": "agentMessage", "itemId": "item-1",
						"turnId": turnID, "text": "launched"},
				})
				notify("turn/completed", map[string]any{
					"sessionId": "ses-1", "turnId": turnID, "terminal": "completed",
					"viewCursor": "v3",
				})
			default:
				emitTurn()
			}
		case "approval/decide":
			answer(id, map[string]any{"approvalId": frame.Params["approvalId"],
				"commandId": frame.Params["commandId"], "status": "accepted",
				"terminal": true})
			if awaiting == "decide" {
				awaiting = ""
				notify("approval/resolved", map[string]any{
					"sessionId": "ses-1", "turnId": turnID, "approvalId": "apv-1",
					"decision":           "approved",
					"decidedByCommandId": frame.Params["commandId"],
				})
				emitTurn()
			}
		case "userInput/answer", "userInput/cancel":
			answer(id, map[string]any{"commandId": frame.Params["commandId"],
				"status": "accepted", "userInputId": frame.Params["userInputId"]})
			if awaiting == "answer" {
				awaiting = ""
				notify("userInput/settled", map[string]any{
					"sessionId": "ses-1", "userInputId": "u-1",
					"outcome":            "answered",
					"decidedByCommandId": frame.Params["commandId"],
				})
				notify("turn/completed", map[string]any{
					"sessionId": "ses-1", "turnId": turnID, "terminal": "completed",
				})
			}
		case "turn/steer":
			answer(id, map[string]any{"commandId": frame.Params["commandId"],
				"status": "accepted", "turnId": turnID})
			if awaiting == "steer" {
				awaiting = ""
				text := "unsteered"
				if input, ok := frame.Params["input"].([]any); ok && len(input) > 0 {
					if part, ok := input[0].(map[string]any); ok {
						if said, ok := part["text"].(string); ok {
							text = "steered: " + said
						}
					}
				}
				notify("item/completed", map[string]any{
					"sessionId": "ses-1",
					"item": map[string]any{"kind": "agentMessage", "itemId": "item-9",
						"turnId": turnID, "text": text},
				})
				notify("turn/completed", map[string]any{
					"sessionId": "ses-1", "turnId": turnID, "terminal": "completed",
				})
			}
		case "turn/cancel":
			answer(id, map[string]any{"commandId": frame.Params["commandId"],
				"status": "accepted"})
		case "view/page":
			// The resync's catch-up read. Scripted per test: the dead view's missed
			// tail, or nothing missed at all. Unknown to the stub otherwise, like a
			// host too wedged to answer.
			switch script {
			case "resync-end":
				// The end the dead stream dropped: one late block and the turn's own
				// completion, for the turn the stub started.
				answer(id, map[string]any{
					"events": []any{
						map[string]any{"method": "item/completed", "params": map[string]any{
							"sessionId": "ses-1",
							"item": map[string]any{"kind": "agentMessage", "itemId": "item-late",
								"turnId": turnID, "text": "late hello from the view"},
							"viewCursor": "v9",
						}},
						map[string]any{"method": "turn/completed", "params": map[string]any{
							"sessionId": "ses-1", "turnId": turnID, "terminal": "completed",
							"viewCursor": "v10",
						}},
					},
					"nextCursor": nil,
				})
			case "resync-parked":
				answer(id, map[string]any{"events": []any{}, "nextCursor": nil})
			case "resync-notloaded":
				answer(id, map[string]any{"events": []any{}, "nextCursor": nil})
			case "ask-then-silent":
				// One late block on the first page, nothing after: the cursor the
				// replay advanced past is what a real host would page after.
				pages++
				if pages > 1 {
					answer(id, map[string]any{"events": []any{}, "nextCursor": nil})
					continue
				}
				answer(id, map[string]any{
					"events": []any{
						map[string]any{"method": "item/completed", "params": map[string]any{
							"sessionId": "ses-1",
							"item": map[string]any{"kind": "agentMessage", "itemId": "item-late",
								"turnId": turnID, "text": "late hello from the view"},
							"viewCursor": "v9",
						}},
					},
					"nextCursor": nil,
				})
			default:
				fail(id, "the stub has never heard of "+frame.Method)
			}
		case "session/read":
			// The resync's point-in-time look at whether the turn still runs —
			// and the drain's reconcile of what background work is still open.
			switch script {
			case "drain", "drain-stuck":
				// The fold agrees with the live stream: the workflow is still
				// open. The drain script's run then lands — an update and its
				// completion — while the stuck one never does.
				answer(id, map[string]any{
					"session": map[string]any{"status": "idle", "activeTurnId": nil},
					"history": map[string]any{"mode": "inline", "snapshot": nil,
						"items": []any{
							map[string]any{"kind": "workflow", "itemId": "item-wf",
								"turnId": turnID, "status": "inProgress",
								"revision": 1, "entryId": "inventory"},
						}},
					"pendingRequests": []any{}, "viewCursor": "v3",
				})
				if script != "drain" {
					continue
				}
				notify("item/updated", map[string]any{
					"sessionId": "ses-1", "viewCursor": "v4",
					"item": map[string]any{"kind": "workflow", "itemId": "item-wf",
						"turnId": turnID, "status": "inProgress", "revision": 2,
						"entryId": "inventory",
						"children": []any{
							map[string]any{"childId": "research", "attempt": 1,
								"status": "completed", "label": "research"},
							map[string]any{"childId": "synthesis", "attempt": 1,
								"status": "running", "label": "synthesis"},
						}},
				})
				notify("item/completed", map[string]any{
					"sessionId": "ses-1", "viewCursor": "v5",
					"item": map[string]any{"kind": "workflow", "itemId": "item-wf",
						"turnId": turnID, "status": "completed", "revision": 3,
						"entryId":      "inventory",
						"fallbackText": "inventory done"},
				})
			case "drain-stale":
				// The fold disagrees with the live stream: the workflow the
				// stream saw opening already completed — its completion was
				// dropped — so there is nothing to drain.
				answer(id, map[string]any{
					"session": map[string]any{"status": "idle", "activeTurnId": nil},
					"history": map[string]any{"mode": "inline", "snapshot": nil,
						"items": []any{
							map[string]any{"kind": "workflow", "itemId": "item-wf",
								"turnId": turnID, "status": "completed",
								"revision": 3, "entryId": "inventory"},
						}},
					"pendingRequests": []any{}, "viewCursor": "v3",
				})
			case "resync-end":
				answer(id, map[string]any{
					"session":         map[string]any{"status": "running", "activeTurnId": turnID},
					"pendingRequests": []any{},
					"history":         map[string]any{}, "viewCursor": "",
				})
			case "resync-parked":
				answer(id, map[string]any{
					"session": map[string]any{"status": "running", "activeTurnId": turnID},
					"pendingRequests": []any{
						map[string]any{"kind": "approval", "viewCursor": "v1"},
					},
					"history": map[string]any{}, "viewCursor": "",
				})
			case "resync-notloaded":
				answer(id, map[string]any{
					"session":         map[string]any{"status": "notLoaded", "activeTurnId": nil},
					"pendingRequests": []any{},
					"history":         map[string]any{}, "viewCursor": "",
				})
			case "ask-then-silent":
				answer(id, map[string]any{
					"session": map[string]any{"status": "running", "activeTurnId": turnID},
					"pendingRequests": []any{
						map[string]any{"kind": "approval", "approvalId": "apv-1", "viewCursor": "v1"},
					},
					"history": map[string]any{}, "viewCursor": "",
				})
			case "subagent":
				// The delegation's child, and its own child beneath it: what the driver
				// reads back through the delegation's handle.
				switch frame.Params["sessionId"] {
				case "ses-child":
					answer(id, map[string]any{
						"session": map[string]any{"sessionId": "ses-child"},
						"history": map[string]any{"items": []any{
							map[string]any{"kind": "agentMessage", "itemId": "c-1",
								"text": "child here"},
							map[string]any{"kind": "reasoning", "itemId": "c-2",
								"summary": []any{"a plan"}},
							map[string]any{"kind": "toolCall", "itemId": "c-3",
								"tool": "Read", "args": `{"file":"x"}`},
							map[string]any{"kind": "subagent", "itemId": "c-4",
								"fallbackText": "grandchild did things",
								"subagentId":   "sub-2", "childSessionId": "ses-grandchild",
								"role": "helper", "objective": "fetch one fact",
								"status": "completed",
								"result": map[string]any{"summary": "the fact"}},
						}},
						"pendingRequests": []any{}, "viewCursor": "",
					})
				case "ses-grandchild":
					answer(id, map[string]any{
						"session": map[string]any{"sessionId": "ses-grandchild"},
						"history": map[string]any{"items": []any{
							map[string]any{"kind": "agentMessage", "itemId": "g-1",
								"text": "grandchild here"},
						}},
						"pendingRequests": []any{}, "viewCursor": "",
					})
				default:
					fail(id, "no such session")
				}
			case "subagent-fail":
				fail(id, "the child is gone")
			default:
				fail(id, "the stub has never heard of "+frame.Method)
			}
		case "usage/read":
			// The host's last observation: the same answer a real host gives after a turn,
			// shared with the parse tests so the two can never drift apart.
			if script == "usage-silent" {
				continue // never answered: the harvest must time out, not hold the turn's end
			}
			if script == "usage-fail" {
				fail(id, "nothing observed")
				continue
			}
			var result any
			_ = json.Unmarshal([]byte(museObservedUsage), &result)
			answer(id, result)
		default:
			fail(id, "the stub has never heard of "+frame.Method)
		}
	}
}
