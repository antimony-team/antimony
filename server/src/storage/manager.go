package storage

import (
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"

	"github.com/charmbracelet/log"
	cp "github.com/otiai10/copy"

	"github.com/antimony-team/antimony-server/config"
	"github.com/antimony-team/antimony-server/utils"
)

type Manager struct {
	storagePath    string
	runPath        string
	fileCache      map[string]string
	fileCacheMutex sync.Mutex
	copyOptions    cp.Options

	dirPerm  os.FileMode
	filePerm os.FileMode
}

func CreateManager(config *config.AntimonyConfig, isDevMode bool) *Manager {
	manager := &Manager{
		storagePath:    config.FileSystem.Storage,
		runPath:        config.FileSystem.Run,
		fileCache:      make(map[string]string),
		fileCacheMutex: sync.Mutex{},
		copyOptions: cp.Options{
			Sync: true,
		},
	}

	if isDevMode {
		manager.dirPerm = 0777
		manager.filePerm = 0666
	} else {
		manager.dirPerm = 0750
		manager.filePerm = 0640
	}

	manager.setupDirectories()

	return manager
}

func (m *Manager) CreateRunEnvironment(
	topologyId string,
	labId string,
	topologyDefinition string,
	topologyFilePath *string,
) error {
	absoluteStoragePath := filepath.Join(m.storagePath, topologyId)
	absoluteRunPath := filepath.Join(m.runPath, labId)

	if err := cp.Copy(absoluteStoragePath, absoluteRunPath, m.copyOptions); err != nil {
		log.Errorf("Failed to create run directory for lab: %s", err.Error())
		return err
	}

	runDefinitionPath := getRunDefinitionFilePath(labId)
	if err := m.writeRun(runDefinitionPath, topologyDefinition); err != nil {
		log.Errorf("Failed to write run definition for lab: %s", err.Error())
		return err
	}

	*topologyFilePath = filepath.Join(m.runPath, runDefinitionPath)
	return nil
}

func (m *Manager) GetRunTopologyDefinitionFile(labId string) string {
	runDefinitionPath := getRunDefinitionFilePath(labId)
	return filepath.Join(m.runPath, runDefinitionPath)
}

func (m *Manager) ReadRunTopologyDefinition(labId string, content *string) error {
	return m.readRun(getRunDefinitionFilePath(labId), content)
}

func (m *Manager) GetRunEnvironment(labId string, definition *string) (*string, error) {
	definitionPath := getRunDefinitionFilePath(labId)

	if err := m.readRun(definitionPath, definition); err != nil {
		return nil, err
	}

	return new(filepath.Join(m.runPath, definitionPath)), nil
}

func (m *Manager) ReadTopology(topologyId string, definition *string, annotations *string) error {
	if err := m.readStorage(getDefinitionFilePath(topologyId), definition); err != nil {
		return err
	}

	return m.readStorage(getAnnotationFilePath(topologyId), annotations)
}

func (m *Manager) WriteTopology(topologyId string, definition *string, annotations *string) error {
	if definition != nil {
		if err := m.writeStorage(getDefinitionFilePath(topologyId), *definition); err != nil {
			return err
		}
	}

	if annotations != nil {
		if err := m.writeStorage(getAnnotationFilePath(topologyId), *annotations); err != nil {
			return err
		}
	}

	return nil
}

func (m *Manager) ReadBindFile(topologyId string, filePath string, content *string) error {
	relativePath, err := bindFilePath(topologyId, filePath)
	if err != nil {
		return err
	}

	return m.readStorage(relativePath, content)
}

func (m *Manager) WriteBindFile(topologyId string, filePath string, content string) error {
	relativePath, err := bindFilePath(topologyId, filePath)
	if err != nil {
		return err
	}

	return m.writeStorage(relativePath, content)
}

func (m *Manager) DeleteBindFile(topologyId string, filePath string) error {
	relativePath, err := bindFilePath(topologyId, filePath)
	if err != nil {
		return err
	}

	return m.deleteStorage(relativePath)
}

func (m *Manager) DeleteRunEnvironment(labId string) error {
	return m.deleteRun(labId)
}

func (m *Manager) setupDirectories() {
	if _, err := os.ReadDir(m.storagePath); err != nil || !isDirectoryWritable(m.storagePath) {
		log.Info("Storage directory not found. Creating.", "dir", m.storagePath)
		if err = os.MkdirAll(m.storagePath, 0750); err != nil {
			log.Fatal("Storage directory is not accessible. Exiting.", "dir", m.storagePath)
			return
		}
	}

	if _, err := os.ReadDir(m.runPath); err != nil || !isDirectoryWritable(m.runPath) {
		log.Info("Run directory not found. Creating.", "dir", m.runPath)
		if err = os.MkdirAll(m.runPath, 0750); err != nil {
			log.Fatal("Run directory is not accessible. Exiting.", "dir", m.runPath)
			return
		}
	}
}

func (m *Manager) writeStorage(relativeFilePath string, content string) error {
	return m.write(filepath.Join(m.storagePath, relativeFilePath), content)
}

func (m *Manager) writeRun(relativeFilePath string, content string) error {
	return m.write(filepath.Join(m.runPath, relativeFilePath), content)
}

func (m *Manager) readStorage(relativeFilePath string, content *string) error {
	return m.read(filepath.Join(m.storagePath, relativeFilePath), content)
}

func (m *Manager) readRun(relativeFilePath string, content *string) error {
	return m.read(filepath.Join(m.runPath, relativeFilePath), content)
}

func (m *Manager) deleteStorage(relativePath string) error {
	return m.delete(filepath.Join(m.storagePath, relativePath))
}

func (m *Manager) deleteRun(relativePath string) error {
	return m.delete(filepath.Join(m.runPath, relativePath))
}

func (m *Manager) read(absoluteFilePath string, content *string) error {
	if data, err := os.ReadFile(absoluteFilePath); err != nil {
		return err
	} else {
		*content = string(data)
	}

	return nil
}

func (m *Manager) write(absoluteFilePath string, content string) error {
	if _, err := os.ReadDir(filepath.Dir(absoluteFilePath)); err != nil {
		if err = os.MkdirAll(filepath.Dir(absoluteFilePath), m.dirPerm); err != nil {
			return utils.ErrFileStorage
		}
	}

	//nolint:gosec // We need this file to be accessible
	return os.WriteFile(absoluteFilePath, ([]byte)(content), m.filePerm)
}

func (m *Manager) delete(absolutePath string) error {
	if err := os.RemoveAll(absolutePath); err != nil {
		return err
	}

	return nil
}

// reservedBindFileNames are file and directory names that Antimony, containerlab, or netlab manage within a topology's
// directory. These names are reserved and bind files can't be named after them.
var reservedBindFileNames = []string{
	// Antimony definitions and annotations (topology.clab.yaml is also the file netlab generates)
	"topology.clab.yaml",
	"topology.clab.yaml.annotations.json",
	"topology.yml",
	"topology.yml.annotations.json",

	// containerlab lab directory (clab-<lab name>/), holding lab state and the lab CA
	"clab-*",

	// containerlab topology templating
	"clab_templates",
	"topology.clab_vars.*",

	// netlab state written by netlab generation
	"netlab.snapshot.pickle",
	"netlab.snapshot.yml",
	"netlab.lock",

	// files and directories netlab create generates
	"hosts.yml",
	"ansible.cfg",
	"group_vars",
	"host_vars",
	"node_files",
	"clab_files",

	// output directory of netlab collect
	"config",
}

// ValidateBindFilePath validates a client-supplied bind file path and returns its canonical form.
func ValidateBindFilePath(filePath string) (string, error) {
	cleaned, err := normalizeBindFilePath(filePath)
	if err != nil {
		return "", err
	}

	if err := checkReservedBindFilePath(cleaned); err != nil {
		return "", err
	}

	return cleaned, nil
}

func normalizeBindFilePath(filePath string) (string, error) {
	cleaned := filepath.Clean(filepath.ToSlash(filePath))

	if !filepath.IsLocal(cleaned) || cleaned == "." {
		return "", fmt.Errorf("%w: %q", utils.ErrInvalidBindFilePath, filePath)
	}

	return cleaned, nil
}

// checkReservedBindFilePath checks if the given file path conflicts with reserved file or directory names.
func checkReservedBindFilePath(filePath string) error {
	firstSegment, _, _ := strings.Cut(filePath, "/")
	firstSegment = strings.ToLower(firstSegment)

	for _, pattern := range reservedBindFileNames {
		if matched, _ := path.Match(pattern, firstSegment); matched {
			return fmt.Errorf("%w: %q is reserved", utils.ErrInvalidBindFilePath, filePath)
		}
	}

	return nil
}

func getDefinitionFilePath(topologyId string) string {
	return filepath.Join(topologyId, "topology.clab.yaml")
}

func getAnnotationFilePath(topologyId string) string {
	return filepath.Join(topologyId, "topology.clab.yaml.annotations.json")
}

func getRunDefinitionFilePath(labId string) string {
	return filepath.Join(labId, "topology.clab.yaml")
}

func bindFilePath(topologyId string, filePath string) (string, error) {
	cleaned, err := normalizeBindFilePath(filePath)
	if err != nil {
		return "", err
	}

	return filepath.Join(topologyId, cleaned), nil
}

func isDirectoryWritable(path string) bool {
	info, err := os.Stat(path)

	// TODO: Proper access check implementation
	return err == nil && info.IsDir() && info.Mode().Perm()&(1<<(uint(7))) != 0
}
