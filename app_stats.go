package main

import (
	"fmt"
	"sort"
	"strings"

	"github.com/IntermezzoSoftware/Masterboard/internal/opening"
	"github.com/IntermezzoSoftware/Masterboard/internal/storage"
)

type OpeningInfo struct {
	PGN string `json:"pgn"`
	FEN string `json:"fen"`
}

func (a *App) GetOpeningInfo(eco, name string) (*OpeningInfo, error) {
	if a.classifier == nil {
		return nil, fmt.Errorf("opening classifier not available")
	}
	entries := a.classifier.LookupAllByECOAndName(eco, name)
	if len(entries) == 0 {
		return nil, fmt.Errorf("opening not found: %s %s", eco, name)
	}

	pgn := buildOpeningPGN(entries)
	fen := entries[0].EPD + " 0 1" // shallowest entry
	return &OpeningInfo{PGN: pgn, FEN: fen}, nil
}

func tokenizePGNMoves(pgn string) []string {
	var moves []string
	for _, tok := range strings.Fields(pgn) {
		if strings.HasSuffix(tok, ".") {
			continue
		}
		switch tok {
		case "*", "1-0", "0-1", "1/2-1/2":
			continue
		}
		moves = append(moves, tok)
	}
	return moves
}

func numberMove(san string, ply int) string {
	moveNum := ply/2 + 1
	if ply%2 == 0 {
		return fmt.Sprintf("%d. %s", moveNum, san)
	}
	return fmt.Sprintf("%d... %s", moveNum, san)
}

func buildOpeningPGN(entries []*opening.Entry) string {
	if len(entries) == 1 {
		return entries[0].Moves
	}

	// Tokenize all entries into SAN move lists.
	lines := make([][]string, len(entries))
	maxLen := 0
	for i, e := range entries {
		lines[i] = tokenizePGNMoves(e.Moves)
		if len(lines[i]) > maxLen {
			maxLen = len(lines[i])
		}
	}

	// Choose the mainline so that the shallowest entry (entries[0]) always lies
	// on it — this ensures targetFen lands on the mainline, not a variation.
	// Among entries that extend the shallowest (same branch), pick the longest
	// so the mainline covers the most positions. If nothing extends it, the
	// shallowest itself is the mainline.
	shallowest := lines[0]
	mainIdx := 0
	for i, l := range lines {
		if len(l) < len(shallowest) {
			continue
		}
		// Check that l is an extension of (or equals) the shallowest line.
		isExtension := true
		for j := 0; j < len(shallowest); j++ {
			if l[j] != shallowest[j] {
				isExtension = false
				break
			}
		}
		if isExtension && len(l) > len(lines[mainIdx]) {
			mainIdx = i
		}
	}
	mainline := lines[mainIdx]

	// Collect variation lines: for each non-mainline entry, find where it
	// diverges from the mainline. Group variations by divergence ply.
	type variation struct {
		divergePly int   // ply index where the variation departs from the mainline
		moves      []string
	}
	var variations []variation
	for i, l := range lines {
		if i == mainIdx {
			continue
		}
		// Find first ply where this line differs from the mainline.
		diverge := 0
		for diverge < len(l) && diverge < len(mainline) && l[diverge] == mainline[diverge] {
			diverge++
		}
		if diverge >= len(l) {
			// This line is a prefix of the mainline — already covered.
			continue
		}
		variations = append(variations, variation{divergePly: diverge, moves: l})
	}

	// Sort variations by divergence point (earliest first) so the PGN reads
	// naturally.
	sort.Slice(variations, func(i, j int) bool {
		return variations[i].divergePly < variations[j].divergePly
	})

	// Build PGN string: walk the mainline, inserting variations after the
	// mainline move at the divergence point. In standard PGN, a variation
	// appears after the mainline move it is an alternative to. A variation
	// diverging at ply N is placed after the mainline writes ply N (the first
	// move where the lines differ). Variations diverging at ply 0 go after
	// the mainline's ply 0 move.
	var b strings.Builder
	varIdx := 0
	for ply, san := range mainline {
		if ply > 0 {
			b.WriteByte(' ')
		}
		b.WriteString(numberMove(san, ply))

		for varIdx < len(variations) && variations[varIdx].divergePly <= ply {
			v := variations[varIdx]
			b.WriteString(" (")
			for j := v.divergePly; j < len(v.moves); j++ {
				if j > v.divergePly {
					b.WriteByte(' ')
				}
				b.WriteString(numberMove(v.moves[j], j))
			}
			b.WriteByte(')')
			varIdx++
		}
	}

	// Append any remaining variations that diverge past the end of the mainline.
	for ; varIdx < len(variations); varIdx++ {
		v := variations[varIdx]
		b.WriteString(" (")
		for j := v.divergePly; j < len(v.moves); j++ {
			if j > v.divergePly {
				b.WriteByte(' ')
			}
			b.WriteString(numberMove(v.moves[j], j))
		}
		b.WriteByte(')')
	}

	return b.String()
}

func (a *App) GetOpeningInfoByECO(eco string) (*OpeningInfo, error) {
	if a.classifier == nil {
		return nil, fmt.Errorf("opening classifier not available")
	}
	e := a.classifier.LookupByECO(eco)
	if e == nil {
		return nil, fmt.Errorf("opening not found for ECO: %s", eco)
	}
	fen := e.EPD + " 0 1"
	return &OpeningInfo{PGN: e.Moves, FEN: fen}, nil
}

type StatsFilters struct {
	PlayerNames          []string `json:"playerNames"`
	FolderID             string   `json:"folderId"`
	CollectionID         string   `json:"collectionId"`
	ExcludeFolderIDs     []string `json:"excludeFolderIds"`
	ExcludeCollectionIDs []string `json:"excludeCollectionIds"`
}

func (f StatsFilters) toStorage() storage.StatsFilters {
	return storage.StatsFilters{
		PlayerNames:          f.PlayerNames,
		FolderID:             f.FolderID,
		CollectionID:         f.CollectionID,
		ExcludeFolderIDs:     f.ExcludeFolderIDs,
		ExcludeCollectionIDs: f.ExcludeCollectionIDs,
	}
}

func (a *App) GetPlayerVariationStats(filters StatsFilters) ([]storage.OpeningRow, error) {
	if err := a.requireDB(); err != nil {
		return nil, err
	}
	return a.db.GetPlayerVariationStats(filters.toStorage())
}

func (a *App) GetPlayerStats(filters StatsFilters) (*storage.PlayerStats, error) {
	if err := a.requireDB(); err != nil {
		return nil, err
	}
	stats, err := a.db.GetPlayerStats(filters.toStorage())
	if err != nil {
		return nil, err
	}
	// Replace MAX(g.opening) names with the canonical ECO base name from the
	// opening library, so ECO-grouped rows show the top-level name rather than
	// whichever sub-variation happened to sort last alphabetically.
	if a.classifier != nil {
		for i := range stats.ByOpening {
			if e := a.classifier.LookupByECO(stats.ByOpening[i].ECO); e != nil {
				stats.ByOpening[i].Opening = e.Name
			}
		}
	}
	return stats, nil
}

type OpeningTreeNode struct {
	ECO        string             `json:"eco"`
	Opening    string             `json:"opening"`
	Games      int                `json:"games"`
	AsWhite    int                `json:"asWhite"`
	AsBlack    int                `json:"asBlack"`
	WhiteWins  int                `json:"whiteWins"`
	WhiteDraws int                `json:"whiteDraws"`
	BlackWins  int                `json:"blackWins"`
	BlackDraws int                `json:"blackDraws"`
	Children   []*OpeningTreeNode `json:"children,omitempty"`
}

func (a *App) GetPlayerOpeningTree(filters StatsFilters) ([]*OpeningTreeNode, error) {
	if err := a.requireDB(); err != nil {
		return nil, err
	}
	rawRows, err := a.db.GetPlayerVariationStats(filters.toStorage())
	if err != nil {
		return nil, err
	}
	if len(rawRows) == 0 {
		return nil, nil
	}

	type nodeKey struct{ eco, name string }
	nodes := make(map[nodeKey]*OpeningTreeNode, len(rawRows)*2)

	getOrCreate := func(eco, name string) *OpeningTreeNode {
		k := nodeKey{eco, name}
		if n := nodes[k]; n != nil {
			return n
		}
		n := &OpeningTreeNode{ECO: eco, Opening: name}
		nodes[k] = n
		return n
	}

	// Create leaf nodes from variation stats and ensure all ancestors exist.
	for _, row := range rawRows {
		leaf := getOrCreate(row.ECO, row.Opening)
		leaf.Games = row.Games
		leaf.AsWhite = row.AsWhite
		leaf.AsBlack = row.AsBlack
		leaf.WhiteWins = row.WhiteWins
		leaf.WhiteDraws = row.WhiteDraws
		leaf.BlackWins = row.BlackWins
		leaf.BlackDraws = row.BlackDraws
		if a.classifier != nil {
			for _, anc := range a.classifier.Ancestors(row.ECO, row.Opening) {
				getOrCreate(anc.ECO, anc.Name)
			}
		}
	}

	// Link children to parents.
	if a.classifier != nil {
		for k, node := range nodes {
			if p := a.classifier.Parent(k.eco, k.name); p != nil {
				if pNode := nodes[nodeKey{p.ECO, p.Name}]; pNode != nil {
					pNode.Children = append(pNode.Children, node)
				}
			}
		}
	}

	// Post-order aggregation: accumulate each child's stats into its parent.
	var aggregate func(*OpeningTreeNode)
	aggregate = func(n *OpeningTreeNode) {
		for _, child := range n.Children {
			aggregate(child)
			n.Games += child.Games
			n.AsWhite += child.AsWhite
			n.AsBlack += child.AsBlack
			n.WhiteWins += child.WhiteWins
			n.WhiteDraws += child.WhiteDraws
			n.BlackWins += child.BlackWins
			n.BlackDraws += child.BlackDraws
		}
	}

	// Collect roots: nodes whose parent is absent from our set.
	var roots []*OpeningTreeNode
	for k, node := range nodes {
		var p *opening.Entry
		if a.classifier != nil {
			p = a.classifier.Parent(k.eco, k.name)
		}
		if p == nil || nodes[nodeKey{p.ECO, p.Name}] == nil {
			roots = append(roots, node)
		}
	}
	for _, root := range roots {
		aggregate(root)
	}

	sort.Slice(roots, func(i, j int) bool { return roots[i].Games > roots[j].Games })
	return roots, nil
}

// ExcludeFolderIDs and ExcludeCollectionIDs are not forwarded — the position index does not support exclusion filtering (v1 known gap).
func (a *App) GetMoveTreeStats(fen string, filters StatsFilters, playerSide string) ([]storage.PersonalMoveStat, error) {
	if err := a.requireDB(); err != nil {
		return nil, err
	}
	return a.db.GetPersonalPositionStats(fen, storage.PositionFilters{
		PlayerNames:  filters.PlayerNames,
		FolderID:     filters.FolderID,
		CollectionID: filters.CollectionID,
		PlayerSide:   playerSide,
	})
}

func (a *App) GetPlayerAnalysisStats(filters StatsFilters) (*storage.PlayerAnalysisStats, error) {
	if err := a.requireDB(); err != nil {
		return nil, err
	}
	return a.db.GetPlayerAnalysisStats(filters.toStorage())
}
