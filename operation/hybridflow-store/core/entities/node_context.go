package entities

import "regexp"

// The runner resolves these references when it plays the flow node.
var nodeContextReference = regexp.MustCompile(`\{\{\s*(?:(?:input|currentWokflow|currentWorkflow)(?:\.[^{}\s]+)?|role\.` + roleIDPattern + `)\s*\}\}`)
