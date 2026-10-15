package transport

import "antimonyBackend/domain/collection"

type CollectionOut struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	PublicWrite  bool    `json:"publicWrite"`
	PublicDeploy bool    `json:"publicDeploy"`
	Creator      UserOut `json:"creator"`
}

func CollectionToOut(collection *collection.Collection) *CollectionOut {
	return &CollectionOut{
		ID:           collection.UUID,
		Name:         collection.Name,
		PublicWrite:  collection.PublicWrite,
		PublicDeploy: collection.PublicDeploy,
		Creator:      UserToOut(&collection.Creator),
	}
}
