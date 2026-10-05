import React from 'react';

import classNames from 'classnames';
import {Button} from 'primereact/button';

import {If} from '@sb/types/control';

import './editor-setup.sass';
import SBEmptyState from '@sb/components/common/sb-empty-state/sb-empty-state';
import {useAuthUser} from '@sb/lib/stores/root-store';

interface EditorSetupProps {
  // Name of the first collection, null if there is none yet
  collectionName: string | null;

  onCreateCollection: () => void;
  onCreateTopology: () => void;
}

type StepState = 'todo' | 'active' | 'done';

interface SetupStepProps {
  number: number;
  title: string;
  text: string;
  state: StepState;
  children?: React.ReactNode;
}

const SetupStep = (props: SetupStepProps) => (
  <div className={classNames('sb-editor-setup-step', props.state)}>
    <span className="sb-editor-setup-step-badge">
      {props.state === 'done' ? (
        <span className="material-symbols-outlined">check</span>
      ) : (
        props.number
      )}
    </span>
    <div className="sb-editor-setup-step-text">
      <span className="sb-editor-setup-step-title">{props.title}</span>
      <span>{props.text}</span>
    </div>
    {props.children}
  </div>
);

const EditorSetup = (props: EditorSetupProps) => {
  const authUser = useAuthUser();
  const hasCollection = props.collectionName !== null;

  if (!hasCollection && !authUser.isAdmin) {
    return (
      <SBEmptyState
        icon={<span className="material-symbols-outlined">lock</span>}
        title="No collections yet"
        text="Topologies live in collections, and only administrators can create them. Ask an administrator to set one up for you."
      />
    );
  }

  return (
    <SBEmptyState
      icon={<span className="material-symbols-outlined">network_node</span>}
      accent
      title="Set up your first topology"
      text="Topologies live in collections, so start with one of those."
    >
      <div className="sb-editor-setup-steps">
        <SetupStep
          number={1}
          title="Create a collection"
          text="A shared folder for related topologies, e.g. a course or a project."
          state={hasCollection ? 'done' : 'active'}
        >
          <If condition={!hasCollection}>
            <Button
              outlined
              icon="pi pi-plus"
              label="New collection"
              onClick={props.onCreateCollection}
            />
          </If>
        </SetupStep>
        <SetupStep
          number={2}
          title="Add a topology"
          text="Describe nodes and links, then deploy it as a lab."
          state={hasCollection ? 'active' : 'todo'}
        >
          <Button
            outlined
            icon="pi pi-plus"
            label="New topology"
            disabled={!hasCollection}
            onClick={props.onCreateTopology}
          />
        </SetupStep>
      </div>
    </SBEmptyState>
  );
};

export default EditorSetup;
