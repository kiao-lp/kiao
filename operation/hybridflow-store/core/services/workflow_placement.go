package services

import (
	"context"
	"image"
	"math"

	"kiao/hybridflow-store/core/entities"
)

// Leave enough space for the two workflow frames and their labels.
const workflowPasteGap = 48

func (t *FlowNodes) placePastedWorkflow(ctx context.Context, boardID string, nodes []entities.FlowNode, at *entities.Spot) error {
	var bounds image.Rectangle
	for _, node := range nodes {
		if spot := node.Spot; spot != nil &&
			(spot.X < math.MinInt32 || spot.Y < math.MinInt32 || spot.X > math.MaxInt32 || spot.Y > math.MaxInt32) {
			return entities.Invalidf("workflow clipboard flow node position is out of range")
		}
		if size := node.Size; size != nil && (size.W > math.MaxInt32 || size.H > math.MaxInt32) {
			return entities.Invalidf("workflow clipboard flow node size is out of range")
		}
		bounds = bounds.Union(pasteFlowNodeBounds(node.Spot, node.Size))
	}
	for i := range nodes {
		if nodes[i].Spot != nil {
			continue
		}
		spot := &entities.Spot{X: bounds.Min.X, Y: bounds.Max.Y + workflowPasteGap}
		if bounds.Empty() {
			spot.Y = 0
		}
		nodes[i].Spot = spot
		bounds = bounds.Union(pasteFlowNodeBounds(spot, nodes[i].Size))
	}

	occupied, err := t.workflowObstacles(ctx, boardID)
	if err != nil {
		return err
	}
	var below int
	for _, box := range occupied {
		below = max(below, box.Max.Y+workflowPasteGap)
	}
	anchor := image.Pt(0, below)
	if at != nil {
		if at.X > math.MaxInt32 || at.Y > math.MaxInt32 {
			return entities.Invalidf("workflow paste position is out of range")
		}
		anchor = image.Pt(max(0, at.X), max(0, at.Y))
		proposed := bounds.Sub(bounds.Min).Add(anchor).Inset(-workflowPasteGap)
		for _, box := range occupied {
			if proposed.Overlaps(box) {
				anchor.Y = below
				break
			}
		}
	}
	if far := bounds.Sub(bounds.Min).Add(anchor).Max; far.X > math.MaxInt32 || far.Y > math.MaxInt32 {
		return entities.Invalidf("workflow paste position is out of range")
	}
	for i := range nodes {
		spot := nodes[i].Spot
		nodes[i].Spot = &entities.Spot{X: anchor.X + (spot.X - bounds.Min.X), Y: anchor.Y + (spot.Y - bounds.Min.Y)}
	}
	return nil
}

func (t *FlowNodes) workflowObstacles(ctx context.Context, boardID string) ([]image.Rectangle, error) {
	nodes, err := t.repo.ListFlowNodes(ctx, boardID)
	if err != nil {
		return nil, err
	}
	var boxes []image.Rectangle
	groups := map[string]image.Rectangle{}
	add := func(spot *entities.Spot, size *entities.Size, group string) {
		box := pasteFlowNodeBounds(spot, size)
		if box.Empty() {
			return
		}
		if group == "" {
			boxes = append(boxes, box)
		} else {
			groups[group] = groups[group].Union(box)
		}
	}
	for _, node := range nodes {
		add(node.Spot, node.Size, node.WorkflowID)
	}
	for _, box := range groups {
		boxes = append(boxes, box)
	}
	return boxes, nil
}

func pasteFlowNodeBounds(spot *entities.Spot, size *entities.Size) image.Rectangle {
	if spot == nil {
		return image.Rectangle{}
	}
	// Use the Dashboard's nominal flow node width and tallest default flow node height.
	w, h := 221, 134
	if size != nil {
		w, h = max(w, size.W), max(h, size.H)
	}
	return image.Rect(spot.X, spot.Y, spot.X+w, spot.Y+h)
}
