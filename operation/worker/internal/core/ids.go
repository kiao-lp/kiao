package core

import (
	"crypto/rand"
	"encoding/hex"
	"strconv"
	"time"
)

// The ids this service mints — a request id, a conversation id, a turn id — all come from these
// two. They sit in the socle because the request id is assigned by the middleware chain and the
// rest are minted by whichever library owns the thing being named.

// NowMillisStr is the millisecond clock an id carries so that ids sort in the order they happened.
func NowMillisStr() string {
	return strconv.FormatInt(time.Now().UnixMilli(), 10)
}

// RandID returns sixteen hex characters of randomness, the tail an id ends in. It falls back to the
// clock rather than failing: an id that could repeat under a broken crypto/rand is a worse log line,
// not a broken service.
func RandID() string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 10)
	}
	return hex.EncodeToString(b[:])
}
