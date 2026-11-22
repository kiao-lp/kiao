package boards

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestOutputContract(t *testing.T) {
	contract, err := CompileOutput(json.RawMessage(`{"type":"object","required":["message"],"properties":{"message":{"type":"string"}},"additionalProperties":false}`))
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct{ name, message, want string }{
		{"valid", "Done.\n```output\n{\"message\": \"hello\"}\n```", `{"message":"hello"}`},
		{"crlf", "```output\r\n{\"message\":\"hello\"}\r\n```", `{"message":"hello"}`},
		{"missing", "Done.", ""},
		{"json fence", "```json\n{\"message\":\"hello\"}\n```", ""},
		{"unclosed", "```output\n{}", ""},
		{"invalid json", "```output\n{\n```", ""},
		{"wrong type", "```output\n{\"message\":42}\n```", ""},
		{"missing field", "```output\n{}\n```", ""},
		{"extra field", "```output\n{\"message\":\"hi\",\"extra\":1}\n```", ""},
		{"multiple", "```output\n{}\n```\n```output\n{}\n```", ""},
		{"nested example", "````markdown\n```output\n{}\n```\n````", ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			output, err := contract.Extract(test.message)
			if test.want == "" {
				if err == nil {
					t.Fatalf("accepted %q", test.message)
				}
				return
			}
			if err != nil || string(output) != test.want {
				t.Fatalf("output = %s, %v", output, err)
			}
		})
	}
	for _, part := range []string{"Do the work", "```output", `"required":["message"]`, "final message"} {
		if !strings.Contains(contract.Prompt("Do the work"), part) {
			t.Errorf("prompt missing %q", part)
		}
	}
}

func TestOutputSchemaReferencesAndScalars(t *testing.T) {
	for _, test := range []struct{ schema, message, want string }{
		{`{"$defs":{"message":{"type":"string"}},"$ref":"#/$defs/message"}`, "```output\n\"hello\"\n```", `"hello"`},
		{`true`, "```output\nnull\n```", "null"},
		{`{"type":"array","items":{"type":"integer"}}`, "```output\n[0,9007199254740993]\n```", "[0,9007199254740993]"},
	} {
		contract, err := CompileOutput(json.RawMessage(test.schema))
		if err != nil {
			t.Fatal(err)
		}
		got, err := contract.Extract(test.message)
		if err != nil || string(got) != test.want {
			t.Fatalf("output = %s, %v", got, err)
		}
	}
	for _, raw := range []string{`{"type":"strng"}`, `42`, `{"$ref":"file:///missing-schema.json"}`} {
		if _, err := CompileOutput(json.RawMessage(raw)); err == nil {
			t.Errorf("accepted schema %s", raw)
		}
	}
}

func TestRenderInput(t *testing.T) {
	input := json.RawMessage(`{"message":"hello {{input.other}}","nested":{"items":["one",{"ok":false}]},"count":9007199254740993,"empty":"","nil":null}`)
	for _, test := range []struct{ prompt, want string }{
		{"Say {{input.message}}", "Say hello {{input.other}}"},
		{"{{ input.nested.items.1.ok }} / {{input.count}} / {{input.nil}}", "false / 9007199254740993 / null"},
		{"{{input.nested.items.0}}", "one"},
		{"before{{input.empty}}after", "beforeafter"},
		{"{{input.nested}}", `{"items":["one",{"ok":false}]}`},
	} {
		got, err := RenderInput(test.prompt, input)
		if err != nil || got != test.want {
			t.Errorf("render %q = %q, %v", test.prompt, got, err)
		}
	}
	for _, prompt := range []string{"{{input.missing}}", "{{input.nested.items.9}}", "{{input.count.field}}"} {
		if _, err := RenderInput(prompt, input); err == nil {
			t.Errorf("accepted %q", prompt)
		}
	}
	if _, err := RenderInput("{{input.message}}", nil); err == nil {
		t.Error("missing predecessor accepted")
	}
	if got, err := RenderInput("No input", nil); err != nil || got != "No input" {
		t.Fatal(got, err)
	}
}

func TestBoardInputUsesSuccessfulPredecessors(t *testing.T) {
	board := BoardContent{FlowNodes: []FlowNode{
		{ID: "one", Status: FlowNodeStatusDone, Output: json.RawMessage(`{"message":"hello"}`), OnSuccess: FlowNodeSuccess{FlowNode: "next"}},
		{ID: "next"},
	}}
	if got := string(board.Input("next")); got != `{"message":"hello"}` {
		t.Fatal(got)
	}
	board.FlowNodes[0].Status = FlowNodeStatusError
	if got := board.Input("next"); got != nil {
		t.Fatalf("stale output used: %s", got)
	}
	board.FlowNodes[0].Status = FlowNodeStatusDone
	board.FlowNodes = append(board.FlowNodes, FlowNode{ID: "two", Status: FlowNodeStatusDone, Output: json.RawMessage(`42`), OnSuccess: FlowNodeSuccess{FlowNode: "next"}})
	if got := string(board.Input("next")); got != `[{"message":"hello"},42]` {
		t.Fatal(got)
	}
	board.FlowNodes[0].Archived = true
	if got := string(board.Input("next")); got != `42` {
		t.Fatal(got)
	}
}
