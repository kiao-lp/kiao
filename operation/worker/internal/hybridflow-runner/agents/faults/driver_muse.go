package faults

// museBlockedTwiceMessage is the failure a turn ends on when it blocks a second time, after its
// resume. The chain runner reads it as the signal to fork the conversation and play the flow
// node again from the fork; anything else reading it reads a turn that never finished.
const MuseBlockedTwiceMessage = "Muse was blocked twice without ending the turn."
