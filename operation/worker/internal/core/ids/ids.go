package ids

import (
	"crypto/rand"
	"encoding/hex"
	"strconv"
	"time"
)

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
