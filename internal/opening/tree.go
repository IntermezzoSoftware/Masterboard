package opening

import "strings"

// trieNode is an internal node in the move-sequence prefix trie.
type trieNode struct {
	entry    *Entry
	children map[string]*trieNode
}

// tokenizeMoves strips move-number tokens (e.g. "1.", "2.") and result tokens
// from a PGN move sequence, returning only the SAN move strings.
func tokenizeMoves(pgn string) []string {
	fields := strings.Fields(pgn)
	moves := make([]string, 0, len(fields))
	for _, f := range fields {
		if strings.HasSuffix(f, ".") {
			continue
		}
		switch f {
		case "*", "1-0", "0-1", "1/2-1/2":
			continue
		}
		moves = append(moves, f)
	}
	return moves
}

// buildPrefixTree constructs the opening trie and parent/child maps from
// c.allEntries. Called once from NewClassifier() after all TSV rows are loaded.
func (c *Classifier) buildPrefixTree() {
	root := &trieNode{children: make(map[string]*trieNode)}

	// Insert every entry into the trie keyed by its SAN move sequence.
	for _, e := range c.allEntries {
		node := root
		for _, m := range tokenizeMoves(e.Moves) {
			if _, ok := node.children[m]; !ok {
				node.children[m] = &trieNode{children: make(map[string]*trieNode)}
			}
			node = node.children[m]
		}
		if node.entry == nil {
			node.entry = e
		}
	}

	// Walk the trie depth-first to derive parent→child relationships.
	// At each node, the "current parent" is the deepest entry seen on the path
	// from the root — intermediate trie nodes without entries are transparent.
	c.parentByKey = make(map[string]*Entry, len(c.allEntries))
	c.childrenByKey = make(map[string][]*Entry, len(c.allEntries)/4)

	var traverse func(node *trieNode, parent *Entry)
	traverse = func(node *trieNode, parent *Entry) {
		current := parent
		if node.entry != nil {
			key := node.entry.ECO + "|" + node.entry.Name
			c.parentByKey[key] = parent
			if parent != nil {
				pKey := parent.ECO + "|" + parent.Name
				c.childrenByKey[pKey] = append(c.childrenByKey[pKey], node.entry)
			}
			current = node.entry
		}
		for _, child := range node.children {
			traverse(child, current)
		}
	}
	traverse(root, nil)
}
