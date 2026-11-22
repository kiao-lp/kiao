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

var outputFenceLine = regexp.MustCompile("^ {0,3}(`{3,}|~{3,})(.*)$")

func (c *OutputContract) Extract(message string) (json.RawMessage, error) {
	if c == nil {
		return nil, nil
	}
	var fence, language string
	var body []string
	var outputs []string
	for _, line := range strings.Split(strings.ReplaceAll(message, "\r\n", "\n"), "\n") {
		match := outputFenceLine.FindStringSubmatch(line)
		if fence == "" {
			if match != nil {
				fence, language = match[1], strings.TrimSpace(match[2])
				body = nil
			}
		} else if match != nil && match[1][0] == fence[0] && len(match[1]) >= len(fence) && strings.TrimSpace(match[2]) == "" {
			if language == "output" {
				outputs = append(outputs, strings.Join(body, "\n"))
			}
			fence = ""
		} else if language == "output" {
			body = append(body, line)
		}
	}
	if len(outputs) != 1 || (fence != "" && language == "output") {
		return nil, fmt.Errorf("the final message must contain exactly one complete output block")
	}
	raw := []byte(strings.TrimSpace(outputs[0]))
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

// A join exposes predecessor outputs in board order; a single predecessor passes its value through.
func (b *BoardContent) Input(id string) json.RawMessage {
	preds := b.PredecessorsOf(id)
	if len(preds) == 0 {
		return nil
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

var inputSlot = regexp.MustCompile(`\{\{\s*(input(?:\.[^{}\s]+)?)\s*\}\}`)

func RenderInput(prompt string, input json.RawMessage) (string, error) {
	if !inputSlot.MatchString(prompt) {
		return prompt, nil
	}
	if len(input) == 0 {
		return "", fmt.Errorf("the prompt uses input but its predecessor has no successful output")
	}
	var root any
	decoder := json.NewDecoder(bytes.NewReader(input))
	decoder.UseNumber()
	if err := decoder.Decode(&root); err != nil {
		return "", fmt.Errorf("invalid predecessor output: %w", err)
	}
	var problem error
	result := inputSlot.ReplaceAllStringFunc(prompt, func(slot string) string {
		path := inputSlot.FindStringSubmatch(slot)[1]
		value := root
		for _, key := range strings.Split(path, ".")[1:] {
			switch held := value.(type) {
			case map[string]any:
				var exists bool
				value, exists = held[key]
				if !exists {
					problem = fmt.Errorf("input has no field %q", path)
					return slot
				}
			case []any:
				index, err := strconv.Atoi(key)
				if err != nil || index < 0 || index >= len(held) {
					problem = fmt.Errorf("input has no field %q", path)
					return slot
				}
				value = held[index]
			default:
				problem = fmt.Errorf("input has no field %q", path)
				return slot
			}
		}
		if text, ok := value.(string); ok {
			return text
		}
		raw, _ := json.Marshal(value)
		return string(raw)
	})
	return result, problem
}
