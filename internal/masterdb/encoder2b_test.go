package masterdb

import (
	"testing"
)

func TestEncodeGame2B_RoundTrip(t *testing.T) {
	games := []struct {
		name     string
		moveText string
	}{
		{"short", "1. e4 e5 1-0"},
		{"ruy_lopez", "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 1-0"},
		{"sicilian", "1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 1-0"},
		{"queens_gambit", "1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 Be7 5. e3 O-O 6. Nf3 Nbd7 1/2-1/2"},
		{"castling_both", "1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. d3 Nf6 5. O-O d6 6. Be3 O-O 1/2-1/2"},
	}

	for _, tt := range games {
		t.Run(tt.name, func(t *testing.T) {
			// Encode with 2-byte encoder.
			blob2b, pos2b, err := EncodeGame2B(tt.moveText)
			if err != nil {
				t.Fatalf("EncodeGame2B: %v", err)
			}

			// Encode with original encoder for comparison.
			_, pos1b, err := EncodeGame(tt.moveText)
			if err != nil {
				t.Fatalf("EncodeGame: %v", err)
			}

			// Check blob size.
			if len(blob2b) != len(pos2b)*2 {
				t.Errorf("blob size: got %d, want %d", len(blob2b), len(pos2b)*2)
			}

			// Verify position records match.
			if len(pos2b) != len(pos1b) {
				t.Fatalf("position count: 2B=%d, 1B=%d", len(pos2b), len(pos1b))
			}
			for i := range pos2b {
				if pos2b[i].Hash != pos1b[i].Hash {
					t.Errorf("position %d: hash mismatch: 2B=%d, 1B=%d", i, pos2b[i].Hash, pos1b[i].Hash)
				}
				if pos2b[i].MoveSAN != pos1b[i].MoveSAN {
					t.Errorf("position %d: SAN mismatch: 2B=%q, 1B=%q", i, pos2b[i].MoveSAN, pos1b[i].MoveSAN)
				}
			}

			// Decode 2-byte blob and verify SAN output matches original.
			decoded, err := DecodeGame2B(blob2b)
			if err != nil {
				t.Fatalf("DecodeGame2B: %v", err)
			}

			origDecoded, err := DecodeGame(func() []byte {
				b, _, _ := EncodeGame(tt.moveText)
				return b
			}())
			if err != nil {
				t.Fatalf("DecodeGame: %v", err)
			}

			if len(decoded) != len(origDecoded) {
				t.Fatalf("decoded length: 2B=%d, 1B=%d", len(decoded), len(origDecoded))
			}
			for i := range decoded {
				if decoded[i] != origDecoded[i] {
					t.Errorf("decoded move %d: 2B=%q, 1B=%q", i, decoded[i], origDecoded[i])
				}
			}
		})
	}
}

func TestEncodeGame2B_Promotion(t *testing.T) {
	// A game with a pawn promotion.
	moveText := "1. e4 d5 2. exd5 c6 3. dxc6 Nf6 4. cxb7 Nd5 5. bxa8=Q 1-0"
	blob, _, err := EncodeGame2B(moveText)
	if err != nil {
		t.Fatalf("EncodeGame2B: %v", err)
	}

	decoded, err := DecodeGame2B(blob)
	if err != nil {
		t.Fatalf("DecodeGame2B: %v", err)
	}

	origDecoded, _ := DecodeGame(func() []byte { b, _, _ := EncodeGame(moveText); return b }())
	if len(decoded) != len(origDecoded) {
		t.Fatalf("decoded length: 2B=%d, 1B=%d", len(decoded), len(origDecoded))
	}
	for i := range decoded {
		if decoded[i] != origDecoded[i] {
			t.Errorf("move %d: 2B=%q, 1B=%q", i, decoded[i], origDecoded[i])
		}
	}
}

func TestEncodeGame2B_EnPassant(t *testing.T) {
	// White plays en passant.
	moveText := "1. e4 d5 2. e5 f5 3. exf6 1-0"
	blob, _, err := EncodeGame2B(moveText)
	if err != nil {
		t.Fatalf("EncodeGame2B: %v", err)
	}

	decoded, err := DecodeGame2B(blob)
	if err != nil {
		t.Fatalf("DecodeGame2B: %v", err)
	}

	origDecoded, _ := DecodeGame(func() []byte { b, _, _ := EncodeGame(moveText); return b }())
	for i := range decoded {
		if decoded[i] != origDecoded[i] {
			t.Errorf("move %d: 2B=%q, 1B=%q", i, decoded[i], origDecoded[i])
		}
	}
}

func TestEncodeGame2B_QueensideCastle(t *testing.T) {
	moveText := "1. d4 d5 2. Nc3 Nc6 3. Bf4 Bf5 4. Qd2 Qd7 5. O-O-O O-O-O 1/2-1/2"
	blob, _, err := EncodeGame2B(moveText)
	if err != nil {
		t.Fatalf("EncodeGame2B: %v", err)
	}

	decoded, err := DecodeGame2B(blob)
	if err != nil {
		t.Fatalf("DecodeGame2B: %v", err)
	}

	origDecoded, _ := DecodeGame(func() []byte { b, _, _ := EncodeGame(moveText); return b }())
	for i := range decoded {
		if decoded[i] != origDecoded[i] {
			t.Errorf("move %d: 2B=%q, 1B=%q", i, decoded[i], origDecoded[i])
		}
	}
}
