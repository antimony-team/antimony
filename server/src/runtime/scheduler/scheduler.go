package scheduler

import (
	"antimonyBackend/config"
	"antimonyBackend/domain/lab"
	"antimonyBackend/runtime/instance"
	"antimonyBackend/utils"
	"context"
	"sync"
	"time"
)

type Scheduler struct {
	config *config.AntimonyConfig

	instanceService *instance.Service

	deploymentSchedule  *utils.Schedule[lab.Lab]
	destructionSchedule *utils.Schedule[lab.Lab]

	// ctx governs the lifetime of the Run loop. It is canceled by Close.
	ctx       context.Context
	cancel    context.CancelFunc
	closeOnce sync.Once
}

func CreateScheduler(
	config *config.AntimonyConfig,
	instanceService *instance.Service,
	labEventBus *utils.EventBus[*lab.Lab],
) *Scheduler {
	deploymentSchedule := utils.CreateSchedule[lab.Lab](
		func(lab lab.Lab) string {
			return lab.UUID
		},
		func(lab lab.Lab) *time.Time {
			return &lab.StartTime
		},
	)

	destructionSchedule := utils.CreateSchedule[lab.Lab](
		func(lab lab.Lab) string {
			return lab.UUID
		},
		func(lab lab.Lab) *time.Time {
			return lab.EndTime
		},
	)

	ctx, cancel := context.WithCancel(context.Background())

	scheduler := &Scheduler{
		config: config,

		instanceService: instanceService,

		deploymentSchedule:  deploymentSchedule,
		destructionSchedule: destructionSchedule,

		ctx:       ctx,
		cancel:    cancel,
		closeOnce: sync.Once{},
	}

	labEventBus.Subscribe("lab.created", scheduler.onLabCreated)
	labEventBus.Subscribe("lab.moved", scheduler.onLabMoved)
	labEventBus.Subscribe("lab.deleted", scheduler.onLabDeleted)
	labEventBus.Subscribe("lab.manually-deployed", scheduler.onLabManuallyDeployed)
	labEventBus.Subscribe("lab.restored", scheduler.onLabRestored)

	return scheduler
}

// Run drives the deployment and destruction queues until the scheduler is closed.
func (s *Scheduler) Run() {
	for {
		if dueLab := s.deploymentSchedule.TryPop(); dueLab != nil {
			// Each consumer gets its own copy. The queues dereference the whole struct to read its
			// time (timeGetter(*item)), so handing the same pointer to a goroutine that mutates the
			// lab — DeployLab writes through to Topology.LastDeployFailed — raced with every later
			// TryPop.
			toDeploy := copyLab(dueLab)

			go func() {
				_ = s.instanceService.DeployLab(toDeploy)
			}()

			// Schedule the destruction of the lab
			s.destructionSchedule.Schedule(copyLab(dueLab))
		}

		if dueLab := s.destructionSchedule.TryPop(); dueLab != nil {
			toDestroy := copyLab(dueLab)

			go func() {
				_ = s.instanceService.DestroyLab(toDestroy)
			}()
		}

		select {
		case <-s.ctx.Done():
			return
		case <-time.After(50 * time.Millisecond):
		}
	}
}

// Close stops the Run loop. It is safe to call more than once.
func (s *Scheduler) Close() {
	s.closeOnce.Do(s.cancel)
}

// copyLab returns a shallow copy of a lab, so the scheduler's queues never share mutable state with the runtime
// services or with each other.
func copyLab(original *lab.Lab) *lab.Lab {
	copied := *original

	return &copied
}

func (s *Scheduler) onLabCreated(lab *lab.Lab) {
	s.deploymentSchedule.Schedule(copyLab(lab))
	s.destructionSchedule.Schedule(copyLab(lab))
}

func (s *Scheduler) onLabDeleted(lab *lab.Lab) {
	s.deploymentSchedule.Remove(lab.UUID)
	s.destructionSchedule.Remove(lab.UUID)
}

func (s *Scheduler) onLabMoved(lab *lab.Lab) {
	s.deploymentSchedule.Reschedule(copyLab(lab))
	s.destructionSchedule.Reschedule(copyLab(lab))
}

func (s *Scheduler) onLabManuallyDeployed(lab *lab.Lab) {
	s.deploymentSchedule.Remove(lab.UUID)
	s.destructionSchedule.Schedule(copyLab(lab))
}

func (s *Scheduler) onLabRestored(lab *lab.Lab) {
	s.destructionSchedule.Schedule(copyLab(lab))
}
