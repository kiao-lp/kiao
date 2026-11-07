package faults

// turnRefusal means nothing was spawned; the same refusal is emitted to conversation subscribers.
type TurnRefusal struct {
	Code    string
	Message string
}
