package login

import (
	"errors"
)

// maxLoginMessage caps the CLI output relayed to the client as a step's message.
const MaxLoginMessage = 2000

// errNoLoginInFlight reports a code (or cancel) arriving with no started login to feed it to —
// typically a stale browser tab, or a service restart between the two steps.
var ErrNoLoginInFlight = errors.New("no sign-in is in progress; start one first")
