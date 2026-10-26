package agents

type PiSecretUse struct {
	ProfileID   string `json:"profileId"`
	ProfileName string `json:"profileName"`
	Provider    string `json:"provider"`
}

type PiSecretOffer struct {
	ID        string        `json:"id"`
	Reference string        `json:"reference"`
	Preview   string        `json:"preview"`
	UsedBy    []PiSecretUse `json:"usedBy"`
}
