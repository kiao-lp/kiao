package agents

import (
	"kiao/worker/internal/core/equipment"
)

type ProfileManager interface {
	ReadProfiles() (PiProfilesDocument, error)
	WriteProfiles(doc PiProfilesDocument) error
	Secret(ref string) (string, bool)
	Installations(doc PiProfilesDocument) []equipment.AgentInstallation
	Profile(id string) (PiProfile, equipment.AgentInstallation, error)
	ResolveProfile(id, model, effort string) (*PiResolvedProfile, error)
	OfferedProfiles() []PiProfileOffer
	ValidateTurn(p *PiResolvedProfile, thinking bool) error
	Models(id string, fresh bool) ([]PiModelOffer, error)
	ModelsFor(profile PiProfile, in equipment.AgentInstallation, fresh bool) ([]PiModelOffer, error)
	CheckConnection(id, model string) error
	Secrets() ([]PiSecretOffer, error)
	PutSecret(id, value string) error
	DeleteSecret(id string) error
}
