package importer

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// StudyMeta holds preview data for a Lichess study.
type StudyMeta struct {
	ID       string             `json:"id"`
	Name     string             `json:"name"`
	Chapters []StudyChapterMeta `json:"chapters"`
	Private  bool               `json:"private"`
}

// StudyChapterMeta is per-chapter preview metadata.
type StudyChapterMeta struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Orientation string `json:"orientation"` // "white" or "black"
}

// StudySummary is a brief record from GET /api/study/by/{username}.
type StudySummary struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Chapters int    `json:"chapters"`
}

// FetchStudiesByUser lists all studies owned by the given username.
func FetchStudiesByUser(username, token string) ([]StudySummary, error) {
	rawURL := "https://lichess.org/api/study/by/" + username
	client := &http.Client{Timeout: 30 * time.Second}
	req, err := http.NewRequest("GET", rawURL, nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Accept", "application/x-ndjson")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("GET studies: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("lichess API returned %d", resp.StatusCode)
	}
	var studies []StudySummary
	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var s struct {
			ID       string `json:"id"`
			Name     string `json:"name"`
			Chapters int    `json:"chapters"`
		}
		if err := json.Unmarshal([]byte(line), &s); err != nil {
			continue
		}
		studies = append(studies, StudySummary{ID: s.ID, Name: s.Name, Chapters: s.Chapters})
	}
	return studies, scanner.Err()
}

// ErrStudyPrivate is returned when the study requires authentication.
var ErrStudyPrivate = fmt.Errorf("study is private or unlisted: connect your Lichess account in Settings")

// FetchStudyMeta fetches chapter names and orientations without downloading full move trees.
// token may be empty for public studies.
func FetchStudyMeta(studyID, token string) (StudyMeta, error) {
	rawURL := fmt.Sprintf(
		"https://lichess.org/api/study/%s.pgn?variations=false&comments=false&orientation=true&clocks=false&evals=false",
		studyID,
	)
	body, priv, err := lichessStudyGET(rawURL, token, 30*time.Second)
	if priv {
		return StudyMeta{Private: true}, ErrStudyPrivate
	}
	if err != nil {
		return StudyMeta{}, err
	}
	return parseStudyMeta(studyID, body)
}

// FetchStudyPGN downloads the full annotated PGN for all chapters.
func FetchStudyPGN(studyID, token string) (string, error) {
	rawURL := fmt.Sprintf(
		"https://lichess.org/api/study/%s.pgn?variations=true&comments=true&orientation=true&clocks=false&evals=false",
		studyID,
	)
	body, priv, err := lichessStudyGET(rawURL, token, 120*time.Second)
	if priv {
		return "", ErrStudyPrivate
	}
	return body, err
}

// SplitChapterPGNs splits a concatenated multi-chapter PGN at [Event boundaries.
func SplitChapterPGNs(multiPGN string) []string {
	var chapters []string
	var cur strings.Builder
	scanner := bufio.NewScanner(strings.NewReader(multiPGN))
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "[Event ") && cur.Len() > 0 {
			chapters = append(chapters, strings.TrimSpace(cur.String()))
			cur.Reset()
		}
		cur.WriteString(line)
		cur.WriteByte('\n')
	}
	if cur.Len() > 0 {
		chapters = append(chapters, strings.TrimSpace(cur.String()))
	}
	return chapters
}

// ExtractPGNHeader returns the value of a PGN tag, e.g. ExtractPGNHeader(pgn, "Event") → chapter name.
func ExtractPGNHeader(pgn, tag string) string {
	prefix := "[" + tag + " \""
	for _, line := range strings.Split(pgn, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, prefix) && strings.HasSuffix(line, "\"]") {
			return line[len(prefix) : len(line)-2]
		}
	}
	return ""
}

// parseStudyMeta extracts StudyMeta from a headers-only PGN response.
func parseStudyMeta(studyID, pgn string) (StudyMeta, error) {
	chapters := SplitChapterPGNs(pgn)
	if len(chapters) == 0 {
		return StudyMeta{}, fmt.Errorf("no chapters in study %q", studyID)
	}
	meta := StudyMeta{ID: studyID}
	for i, ch := range chapters {
		name := ExtractPGNHeader(ch, "Event")
		if i == 0 {
			// Lichess Event tags follow "Study Name: Chapter Name" format.
			if idx := strings.Index(name, ": "); idx >= 0 {
				meta.Name = name[:idx]
			} else if name != "" {
				meta.Name = name
			} else {
				meta.Name = "Lichess Study " + studyID
			}
		}
		site := ExtractPGNHeader(ch, "Site")
		orientation := strings.ToLower(ExtractPGNHeader(ch, "Orientation"))
		if orientation == "" {
			orientation = "white"
		}
		meta.Chapters = append(meta.Chapters, StudyChapterMeta{
			ID:          chapterIDFromSite(studyID, site),
			Name:        name,
			Orientation: orientation,
		})
	}
	return meta, nil
}

func chapterIDFromSite(studyID, siteURL string) string {
	prefix := "https://lichess.org/study/" + studyID + "/"
	if strings.HasPrefix(siteURL, prefix) {
		return strings.TrimPrefix(siteURL, prefix)
	}
	return siteURL
}

func lichessStudyGET(rawURL, token string, timeout time.Duration) (body string, private bool, err error) {
	client := &http.Client{Timeout: timeout}
	req, err := http.NewRequest("GET", rawURL, nil)
	if err != nil {
		return "", false, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Accept", "application/x-chess-pgn")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", false, fmt.Errorf("GET %s: %w", rawURL, err)
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusUnauthorized, http.StatusForbidden:
		return "", true, ErrStudyPrivate
	case http.StatusNotFound:
		return "", false, fmt.Errorf("study not found")
	case http.StatusTooManyRequests:
		return "", false, fmt.Errorf("Lichess rate limit exceeded — please wait 60 seconds and try again")
	case http.StatusOK:
	default:
		return "", false, fmt.Errorf("lichess API returned %d", resp.StatusCode)
	}
	b, err := io.ReadAll(resp.Body)
	return string(b), false, err
}
