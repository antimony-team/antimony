import React, {useMemo} from 'react';

import classNames from 'classnames';
import {observer} from 'mobx-react-lite';

import {Button} from 'primereact/button';

import SBEmptyState from '@sb/components/common/sb-empty-state/sb-empty-state';
import {useAuthUser, useCollectionStore} from '@sb/lib/stores/root-store';
import {Choose, If, Otherwise, When} from '@sb/types/control';

import './editor-setup.sass';

interface EditorSetupProps {
  onCreateCollection: () => void;
  onCreateTopology: (collectionId: string) => void;
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
      <Choose>
        <When condition={props.state === 'done'}>
          <span
            className="material-symbols-outlined"
            role="img"
            aria-label="Done"
          >
            check
          </span>
        </When>
        <Otherwise>{props.number}</Otherwise>
      </Choose>
    </span>
    <div className="sb-editor-setup-step-text">
      <span className="sb-editor-setup-step-title">{props.title}</span>
      <span>{props.text}</span>
    </div>
    {props.children}
  </div>
);

const EditorSetup = observer((props: EditorSetupProps) => {
  const authUser = useAuthUser();
  const collectionStore = useCollectionStore();

  const targetCollection = useMemo(() => {
    const userCollections = collectionStore.data.filter(collection =>
      collectionStore.canWriteIn(collection.id),
    );

    if (userCollections.length === 0) {
      return null;
    }

    return userCollections[0];
  }, [authUser, collectionStore.data]);

  if (!targetCollection && !authUser.isAdmin) {
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
          state={targetCollection ? 'done' : 'active'}
        >
          <If condition={!targetCollection}>
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
          state={targetCollection ? 'active' : 'todo'}
        >
          <Button
            outlined
            icon="pi pi-plus"
            label="New topology"
            disabled={!targetCollection}
            onClick={() => {
              if (!targetCollection) return;

              props.onCreateTopology(targetCollection.id);
            }}
          />
        </SetupStep>
      </div>
    </SBEmptyState>
  );
});

export default EditorSetup;
