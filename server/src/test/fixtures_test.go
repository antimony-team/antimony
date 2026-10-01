package test

import (
	"antimonyBackend/auth"
	"antimonyBackend/domain/collection"
	"antimonyBackend/domain/lab"
	"antimonyBackend/domain/topology"
	"antimonyBackend/domain/user"
	"strings"
	"time"

	"github.com/stretchr/testify/require"
	"gorm.io/gorm/clause"
)

// Collection names. Access for non-admin users is granted by collection *name*, which is what the
// Collections field of an authenticated user holds.
const (
	CollectionPublicRW     = "public-rw"     // publicWrite, no publicDeploy
	CollectionPublicDeploy = "public-deploy" // publicDeploy, no publicWrite
	CollectionPublicBoth   = "public-both"   // publicWrite and publicDeploy
	CollectionPrivate      = "private"       // neither
	CollectionHidden       = "hidden"        // no non-admin user is a member
)

// Deterministic UUIDs for the seeded rows, so tests can build URLs without a lookup.
const (
	UserAdminID     = "user-admin"
	UserAdminBareID = "user-admin-bare"
	UserMemberID    = "user-member"
	UserOutsiderID  = "user-outsider"

	TopologyAdminID   = "topo-admin"
	TopologyMemberID  = "topo-member"
	TopologyPrivateID = "topo-private"
	TopologyHiddenID  = "topo-hidden"

	BindFileID = "bindfile-admin"

	LabAdminID  = "lab-admin"
	LabMemberID = "lab-member"
	LabHiddenID = "lab-hidden"
	LabPastID   = "lab-past"
	LabFutureID = "lab-future"
)

// Instance names of the seeded labs. These are fixed rather than generated so that a test can
// pre-register a running instance with the DummyProvider before the harness seeds anything, which is
// how the revive-on-startup path is set up.
const (
	InstanceAdminLab  = "admin-topo-adminlab"
	InstanceMemberLab = "member-topo-memberlab"
	InstanceHiddenLab = "hidden-topo-hiddenlab"
	InstancePastLab   = "admin-topo-pastlab"
	InstanceFutureLab = "admin-topo-futurelab"
)

// Node names declared by the seeded topologies.
const (
	// NodeSRL is of kind nokia_srlinux, which the default kinds config marks as not restartable.
	NodeSRL = "srl1"
	// NodeHost is of kind linux, which the default kinds config marks as restartable.
	NodeHost = "host1"
)

// Topology definitions. These must validate against data/clab.schema.json.
const (
	AdminTopologyDefinition = `name: admin-topo
topology:
  nodes:
    srl1:
      kind: nokia_srlinux
      image: ghcr.io/nokia/srlinux
    host1:
      kind: linux
      image: alpine:latest
  links:
    - endpoints: ["srl1:e1-1", "host1:eth1"]
`

	MemberTopologyDefinition = `name: member-topo
topology:
  nodes:
    srl1:
      kind: nokia_srlinux
      image: ghcr.io/nokia/srlinux
    host1:
      kind: linux
      image: alpine:latest
  links:
    - endpoints: ["srl1:e1-1", "host1:eth1"]
`

	PrivateTopologyDefinition = `name: private-topo
topology:
  nodes:
    host1:
      kind: linux
      image: alpine:latest
`

	HiddenTopologyDefinition = `name: hidden-topo
topology:
  nodes:
    host1:
      kind: linux
      image: alpine:latest
`

	// BindFileContent is the content of the seeded bind file.
	BindFileContent = "hostname leaf01\n"
	// BindFilePath is the path of the seeded bind file, relative to the topology directory.
	BindFilePath = "srl1/config.cfg"
)

// SeedUser bundles a database row, the matching authenticated user and a ready-to-use access token.
type SeedUser struct {
	User  user.User
	Auth  auth.AuthenticatedUser
	Token string
}

// ID returns the user's UUID.
func (u SeedUser) ID() string { return u.User.UUID }

// Seed holds every fixture row the harness created.
type Seed struct {
	Admin     SeedUser // admin, member of every collection
	AdminBare SeedUser // admin with no collection memberships, to prove admins bypass scoping
	Member    SeedUser // non-admin, member of every collection except CollectionHidden
	Outsider  SeedUser // non-admin with no collection memberships
	Native    SeedUser // the built-in native admin

	PublicRW     collection.Collection
	PublicDeploy collection.Collection
	PublicBoth   collection.Collection
	Private      collection.Collection
	Hidden       collection.Collection

	AdminTopology   topology.Topology // in PublicBoth, owned by Admin
	MemberTopology  topology.Topology // in PublicBoth, owned by Member
	PrivateTopology topology.Topology // in Private, owned by Admin
	HiddenTopology  topology.Topology // in Hidden, owned by Admin

	BindFile topology.BindFile // on AdminTopology

	AdminLab  lab.Lab // owned by Admin, on AdminTopology
	MemberLab lab.Lab // owned by Member, on MemberTopology
	HiddenLab lab.Lab // owned by Admin, on HiddenTopology
	PastLab   lab.Lab // owned by Admin, end time already passed
	FutureLab lab.Lab // owned by Admin, start time still in the future
}

// seedUsersOnly registers the users and their tokens but leaves the rest of the database empty.
func (h *Harness) seedUsersOnly() *Seed {
	h.T.Helper()

	everyCollection := []string{
		CollectionPublicRW, CollectionPublicDeploy, CollectionPublicBoth, CollectionPrivate, CollectionHidden,
	}

	memberCollections := []string{
		CollectionPublicRW, CollectionPublicDeploy, CollectionPublicBoth, CollectionPrivate,
	}

	seed := &Seed{
		Admin:     h.createUser(UserAdminID, "Admin User", true, everyCollection),
		AdminBare: h.createUser(UserAdminBareID, "Bare Admin", true, nil),
		Member:    h.createUser(UserMemberID, "Member User", false, memberCollections),
		Outsider:  h.createUser(UserOutsiderID, "Outsider User", false, nil),
	}

	// The native user row is created by user.CreateService; only the token is needed here.
	nativeUser, err := h.UserRepo.GetByUuid(h.T.Context(), auth.NativeUserID)
	require.NoError(h.T, err)

	nativeAuth := auth.AuthenticatedUser{
		UserId:      auth.NativeUserID,
		IsAdmin:     true,
		Collections: everyCollection,
	}

	seed.Native = SeedUser{
		User:  *nativeUser,
		Auth:  nativeAuth,
		Token: h.Token(nativeAuth),
	}

	return seed
}

// seedFixtures builds the full fixture graph: users, collections, topologies, a bind file and labs.
func (h *Harness) seedFixtures() *Seed {
	h.T.Helper()

	seed := h.seedUsersOnly()

	seed.PublicRW = h.createCollection(CollectionPublicRW, seed.Admin, true, false)
	seed.PublicDeploy = h.createCollection(CollectionPublicDeploy, seed.Admin, false, true)
	seed.PublicBoth = h.createCollection(CollectionPublicBoth, seed.Admin, true, true)
	seed.Private = h.createCollection(CollectionPrivate, seed.Admin, false, false)
	seed.Hidden = h.createCollection(CollectionHidden, seed.Admin, true, true)

	seed.AdminTopology = h.createTopology(
		TopologyAdminID, AdminTopologyDefinition, seed.PublicBoth, seed.Admin,
	)
	seed.MemberTopology = h.createTopology(
		TopologyMemberID, MemberTopologyDefinition, seed.PublicBoth, seed.Member,
	)
	seed.PrivateTopology = h.createTopology(
		TopologyPrivateID, PrivateTopologyDefinition, seed.Private, seed.Admin,
	)
	seed.HiddenTopology = h.createTopology(
		TopologyHiddenID, HiddenTopologyDefinition, seed.Hidden, seed.Admin,
	)

	seed.BindFile = h.createBindFile(BindFileID, BindFilePath, BindFileContent, seed.AdminTopology)

	now := time.Now()

	seed.AdminLab = h.createLab(labFixture{
		uuid:         LabAdminID,
		name:         "Admin Lab",
		instanceName: InstanceAdminLab,
		startTime:    now.Add(-1 * time.Hour),
		endTime:      ptr(now.Add(1 * time.Hour)),
		topology:     seed.AdminTopology,
		definition:   AdminTopologyDefinition,
		creator:      seed.Admin,
	})

	seed.MemberLab = h.createLab(labFixture{
		uuid:         LabMemberID,
		name:         "Member Lab",
		instanceName: InstanceMemberLab,
		startTime:    now.Add(-30 * time.Minute),
		endTime:      ptr(now.Add(2 * time.Hour)),
		topology:     seed.MemberTopology,
		definition:   MemberTopologyDefinition,
		creator:      seed.Member,
	})

	seed.HiddenLab = h.createLab(labFixture{
		uuid:         LabHiddenID,
		name:         "Hidden Lab",
		instanceName: InstanceHiddenLab,
		startTime:    now.Add(-10 * time.Minute),
		endTime:      ptr(now.Add(3 * time.Hour)),
		topology:     seed.HiddenTopology,
		definition:   HiddenTopologyDefinition,
		creator:      seed.Admin,
	})

	seed.PastLab = h.createLab(labFixture{
		uuid:         LabPastID,
		name:         "Past Lab",
		instanceName: InstancePastLab,
		startTime:    now.Add(-4 * time.Hour),
		endTime:      ptr(now.Add(-2 * time.Hour)),
		topology:     seed.AdminTopology,
		definition:   AdminTopologyDefinition,
		creator:      seed.Admin,
	})

	seed.FutureLab = h.createLab(labFixture{
		uuid:         LabFutureID,
		name:         "Future Lab",
		instanceName: InstanceFutureLab,
		startTime:    now.Add(4 * time.Hour),
		endTime:      ptr(now.Add(6 * time.Hour)),
		topology:     seed.AdminTopology,
		definition:   AdminTopologyDefinition,
		creator:      seed.Admin,
	})

	return seed
}

/*
 * Row builders. Each one is also usable directly from a test that needs an extra fixture.
 */

func (h *Harness) createUser(uuid string, name string, isAdmin bool, collections []string) SeedUser {
	h.T.Helper()

	if collections == nil {
		collections = []string{}
	}

	row := user.User{UUID: uuid, Sub: "sub-" + uuid, Name: name}
	require.NoError(h.T, h.DB.Create(&row).Error)

	authUser := auth.AuthenticatedUser{UserId: uuid, IsAdmin: isAdmin, Collections: collections}

	return SeedUser{User: row, Auth: authUser, Token: h.Token(authUser)}
}

func (h *Harness) createCollection(
	name string,
	creator SeedUser,
	publicWrite bool,
	publicDeploy bool,
) collection.Collection {
	h.T.Helper()

	row := collection.Collection{
		UUID:         "collection-" + name,
		Name:         name,
		PublicWrite:  publicWrite,
		PublicDeploy: publicDeploy,
		CreatorID:    creator.User.ID,
	}

	require.NoError(h.T, h.DB.Omit(clause.Associations).Create(&row).Error)

	row.Creator = creator.User

	return row
}

func (h *Harness) createTopology(
	uuid string,
	definition string,
	topologyCollection collection.Collection,
	creator SeedUser,
) topology.Topology {
	h.T.Helper()

	require.NoError(h.T, h.Storage.WriteTopology(uuid, definition))

	row := topology.Topology{
		UUID:             uuid,
		Name:             topologyNameFromDefinition(definition),
		SyncUrl:          "",
		CollectionID:     topologyCollection.ID,
		CreatorID:        creator.User.ID,
		LastDeployFailed: false,
	}

	require.NoError(h.T, h.DB.Omit(clause.Associations).Create(&row).Error)

	row.Collection = topologyCollection
	row.Creator = creator.User

	return row
}

func (h *Harness) createBindFile(
	uuid string,
	filePath string,
	content string,
	bindFileTopology topology.Topology,
) topology.BindFile {
	h.T.Helper()

	require.NoError(h.T, h.Storage.WriteBindFile(bindFileTopology.UUID, filePath, content))

	row := topology.BindFile{
		UUID:       uuid,
		FilePath:   filePath,
		TopologyID: bindFileTopology.ID,
	}

	require.NoError(h.T, h.DB.Omit(clause.Associations).Create(&row).Error)

	row.Topology = bindFileTopology

	return row
}

type labFixture struct {
	uuid         string
	name         string
	instanceName string
	startTime    time.Time
	endTime      *time.Time
	topology     topology.Topology
	definition   string
	creator      SeedUser
}

// createLab writes the lab's run environment to disk and inserts the row, mirroring what
// lab.Service.Create does but without the permission checks, so fixtures can describe states the
// API would refuse to create (an already-expired lab, for instance).
func (h *Harness) createLab(fixture labFixture) lab.Lab {
	h.T.Helper()

	// The run definition is the topology definition with its name replaced by the instance name,
	// which is what the real service writes and what the deployment provider sees.
	runDefinition := renameTopologyDefinition(fixture.definition, fixture.instanceName)

	var runTopologyFile string
	require.NoError(h.T, h.Storage.CreateRunEnvironment(
		fixture.topology.UUID, fixture.uuid, runDefinition, &runTopologyFile,
	))

	definition := fixture.definition

	row := lab.Lab{
		UUID:               fixture.uuid,
		Name:               fixture.name,
		StartTime:          fixture.startTime,
		EndTime:            fixture.endTime,
		TopologyID:         fixture.topology.ID,
		CreatorID:          fixture.creator.User.ID,
		InstanceName:       fixture.instanceName,
		TopologyDefinition: &definition,
	}

	require.NoError(h.T, h.DB.Omit(clause.Associations).Create(&row).Error)

	row.Topology = fixture.topology
	row.Creator = fixture.creator.User

	return row
}

/*
 * Small helpers.
 */

func ptr[T any](value T) *T { return &value }

func topologyNameFromDefinition(definition string) string {
	for line := range strings.SplitSeq(definition, "\n") {
		if name, found := strings.CutPrefix(line, "name:"); found {
			return strings.TrimSpace(name)
		}
	}

	return ""
}

// renameTopologyDefinition swaps the top-level name of a definition, the way the lab service does
// when it materialises a run environment.
func renameTopologyDefinition(definition string, name string) string {
	lines := strings.Split(definition, "\n")
	for i, line := range lines {
		if strings.HasPrefix(line, "name:") {
			lines[i] = "name: " + name
			break
		}
	}

	return strings.Join(lines, "\n")
}
