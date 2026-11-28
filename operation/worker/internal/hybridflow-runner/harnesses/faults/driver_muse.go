package faults

// Muse emits this failure if a resumed turn blocks again. The chain runner
// forks the conversation and replays the flow node. Other callers see an
// unfinished turn.
const MuseBlockedTwiceMessage = "Muse was blocked twice without ending the turn."
