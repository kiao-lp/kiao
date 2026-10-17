package hybridflowrunner

import (
	"encoding/json"
	"os"
	"time"
)

// claudeCredentials represents the CLI-owned OAuth session in ~/.claude/.credentials.json.
// The CLI renews expired access tokens on the next call; an expired refresh token
// requires human sign-in. Only the latter means the session has ended.
type claudeCredentials struct {
	AccessToken string
	// ExpiresAt is the access token expiry; absent reads as expired.
	ExpiresAt time.Time
	// RefreshTokenExpiresAt is the session expiry; zero means unknown, not expired.
	RefreshTokenExpiresAt time.Time
}

// readClaudeCredentials reads CLI-owned timestamps in epoch milliseconds.
func readClaudeCredentials(path string) (claudeCredentials, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return claudeCredentials{}, err
	}
	var doc struct {
		ClaudeAiOauth struct {
			AccessToken           string `json:"accessToken"`
			ExpiresAt             int64  `json:"expiresAt"`
			RefreshTokenExpiresAt int64  `json:"refreshTokenExpiresAt"`
		} `json:"claudeAiOauth"`
	}
	if err := json.Unmarshal(data, &doc); err != nil {
		return claudeCredentials{}, err
	}
	return claudeCredentials{
		AccessToken:           doc.ClaudeAiOauth.AccessToken,
		ExpiresAt:             time.UnixMilli(doc.ClaudeAiOauth.ExpiresAt),
		RefreshTokenExpiresAt: millisOrZero(doc.ClaudeAiOauth.RefreshTokenExpiresAt),
	}, nil
}

// renewable allows access-token renewal; false means human sign-in is required.
func (c claudeCredentials) renewable(now time.Time) bool {
	// The CLI blanks tokens when the session can no longer be refreshed.
	if c.AccessToken == "" {
		return false
	}
	if c.RefreshTokenExpiresAt.IsZero() {
		return true
	}
	return now.Before(c.RefreshTokenExpiresAt)
}

// millisOrZero preserves absent timestamps as unknown rather than expired.
func millisOrZero(ms int64) time.Time {
	if ms == 0 {
		return time.Time{}
	}
	return time.UnixMilli(ms)
}
