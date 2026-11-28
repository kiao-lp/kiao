package boards

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

type OutputContract struct {
	schema *jsonschema.Schema
	raw    json.RawMessage
}

func CompileOutput(raw json.RawMessage) (*OutputContract, error) {
	doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
	if err != nil {
		return nil, fmt.Errorf("invalid output schema: %w", err)
	}
	c := jsonschema.NewCompiler()
	c.DefaultDraft(jsonschema.Draft2020)
	c.UseLoader(jsonschema.SchemeURLLoader{})
	const location = "urn:hybridflow:output"
	if err := c.AddResource(location, doc); err != nil {
		return nil, err
	}
	schema, err := c.Compile(location)
	if err != nil {
		return nil, fmt.Errorf("invalid output schema: %w", err)
	}
	return &OutputContract{schema: schema, raw: append(json.RawMessage(nil), raw...)}, nil
}

func (c *OutputContract) Prompt(prompt string) string {
	if c == nil {
		return prompt
	}
	return prompt + "\n\nStructured output required: in your final message, include exactly one fenced code block " +
		"labelled output. Put valid JSON matching the schema below inside it. This block is exported as input " +
		"to the next task; prose and other code blocks are not exported. Do not wrap the JSON in another object " +
		"or a JSON string beyond what the schema requires, and do not put comments in it.\n\nSyntax:\n```output\n<JSON matching the schema>\n```\n\nJSON Schema:\n" + string(c.raw)
}

var codeFenceLine = regexp.MustCompile("^ {0,3}(`{3,}|~{3,})(.*)$")

type codeFence struct {
	label      string
	start, end int // Line numbers. A negative end marks an unclosed fence.
}

func codeFences(lines []string) []codeFence {
	var blocks []codeFence
	var fence string
	var block codeFence
	for index, line := range lines {
		match := codeFenceLine.FindStringSubmatch(line)
		if match == nil {
			continue
		}
		if fence == "" {
			fence = match[1]
			block = codeFence{label: strings.TrimSpace(match[2]), start: index, end: -1}
		} else if match[1][0] == fence[0] && len(match[1]) >= len(fence) && strings.TrimSpace(match[2]) == "" {
			block.end = index
			blocks = append(blocks, block)
			fence = ""
		}
	}
	if fence != "" {
		blocks = append(blocks, block)
	}
	return blocks
}

func (c *OutputContract) Extract(message string) (json.RawMessage, error) {
	if c == nil {
		return nil, nil
	}
	var raw []byte
	lines := strings.Split(strings.ReplaceAll(message, "\r\n", "\n"), "\n")
	for _, block := range codeFences(lines) {
		if block.label != "output" {
			continue
		}
		if raw != nil || block.end < 0 {
			return nil, fmt.Errorf("the final message must contain exactly one complete output block")
		}
		raw = []byte(strings.TrimSpace(strings.Join(lines[block.start+1:block.end], "\n")))
	}
	if raw == nil {
		return nil, fmt.Errorf("the final message must contain exactly one complete output block")
	}
	if !json.Valid(raw) {
		return nil, fmt.Errorf("the output block is not valid JSON")
	}
	value, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	if err := c.schema.Validate(value); err != nil {
		return nil, fmt.Errorf("output does not match its JSON Schema: %w", err)
	}
	var compact bytes.Buffer
	_ = json.Compact(&compact, raw)
	return compact.Bytes(), nil
}

// A parallel join exposes outputs in board order. A direct play of an exclusive
// gateway uses the most recent completed predecessor.
func (b *BoardContent) Input(id string) json.RawMessage {
	preds := b.PredecessorsOf(id)
	if len(preds) == 0 {
		return nil
	}
	if b.FlowNode(id).Type == FlowNodeTypeExclusiveGateway {
		var latest *FlowNode
		for i := range preds {
			node := &preds[i]
			if node.Status == FlowNodeStatusDone && (latest == nil || node.Completion > latest.Completion) {
				latest = node
			}
		}
		if latest == nil {
			return nil
		}
		return bytes.Clone(latest.Output)
	}
	values := make([]json.RawMessage, len(preds))
	hasOutput := false
	for i, node := range preds {
		if node.Status == FlowNodeStatusDone && len(node.Output) > 0 {
			values[i], hasOutput = node.Output, true
		}
	}
	if !hasOutput {
		return nil
	}
	if len(values) == 1 {
		return append(json.RawMessage(nil), values[0]...)
	}
	raw, _ := json.Marshal(values)
	return raw
}

var contextSlot = regexp.MustCompile(
	`\{\{\s*(?:(input|` + workflowNamespace + `)(?:\.([^{}\s]+))?|role\.([A-Za-z0-9_-]+))\s*\}\}|` +
		`\{\{\s*(workflowFolder)\s*\}\}(/?)`)

func HasContextReference(text string) bool { return contextSlot.MatchString(text) }

type NodeContext struct {
	Input    json.RawMessage
	Workflow *Workflow
	Roles    map[string]string
}

func (b *BoardContent) NodeContext(flowNode *FlowNode) NodeContext {
	values := NodeContext{Input: b.Input(flowNode.ID), Workflow: b.Workflow(flowNode.Workflow)}
	for _, node := range b.FlowNodes {
		if node.Type == flowNodeTypeRole && !node.Archived && node.RoleID != "" {
			if values.Roles == nil {
				values.Roles = make(map[string]string)
			}
			values.Roles[node.RoleID] = strings.Join(node.People, ", ")
		}
	}
	return values
}

func (c NodeContext) Render(text string) (string, error) {
	roots := make(map[string]any)
	var problem error
	result := contextSlot.ReplaceAllStringFunc(text, func(slot string) string {
		if problem != nil {
			return slot
		}
		match := contextSlot.FindStringSubmatch(slot)
		if match[4] != "" {
			if c.Workflow == nil || c.Workflow.WorkflowFolder == "" {
				problem = fmt.Errorf("the node has no workflow folder for workflowFolder")
				return slot
			}
			if c.Workflow.WorkflowFolder == "/" {
				return "/"
			}
			return c.Workflow.WorkflowFolder + match[5]
		}
		if id := match[3]; id != "" {
			people, found := c.Roles[id]
			if !found {
				problem = fmt.Errorf("the board has no role with ID %q", id)
				return slot
			}
			return people
		}
		namespace, path := match[1], match[2]
		key := namespace
		if namespace != "input" {
			key = "currentWokflow"
		}
		root, loaded := roots[key]
		if !loaded {
			root, problem = contextValue(namespace, c.Input, c.Workflow)
			if problem != nil {
				return slot
			}
			roots[key] = root
		}
		value, found := findContextField(root, path)
		if !found {
			problem = fmt.Errorf("%s has no field %q", namespace, namespace+"."+path)
			return slot
		}
		if text, ok := value.(string); ok {
			return text
		}
		raw, _ := json.Marshal(value)
		return string(raw)
	})
	return result, problem
}

func (c NodeContext) RenderField(field, text string) (string, error) {
	value, err := c.Render(text)
	if err != nil {
		return "", fmt.Errorf("could not resolve %s: %w", field, err)
	}
	return strings.TrimSpace(value), nil
}

func contextValue(namespace string, input json.RawMessage, workflow *Workflow) (any, error) {
	raw, source := input, "predecessor output"
	if namespace == "input" {
		if len(input) == 0 {
			return nil, fmt.Errorf("the predecessor has no successful output for input")
		}
	} else {
		if workflow == nil {
			return nil, fmt.Errorf("the node has no workflow for %s", namespace)
		}
		raw, source = jsonOf(workflow.Context()), "workflow values"
	}
	var root any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(&root); err != nil {
		return nil, fmt.Errorf("invalid %s: %w", source, err)
	}
	return root, nil
}

func findContextField(value any, path string) (any, bool) {
	if path == "" {
		return value, true
	}
	for _, key := range strings.Split(path, ".") {
		switch held := value.(type) {
		case map[string]any:
			var found bool
			value, found = held[key]
			if !found {
				return nil, false
			}
		case []any:
			index, err := strconv.Atoi(key)
			if err != nil || index < 0 || index >= len(held) {
				return nil, false
			}
			value = held[index]
		default:
			return nil, false
		}
	}
	return value, true
}
