import React, {useEffect, useRef} from 'react';

import classNames from 'classnames';
import {observer} from 'mobx-react-lite';

import {IconField} from 'primereact/iconfield';
import {InputIcon} from 'primereact/inputicon';
import {InputText} from 'primereact/inputtext';

import {useCollectionStore, useLabStore} from '@sb/lib/stores/root-store';

import './lab-explorer.sass';

interface LabExplorerProps {
  collectionFilter: string | null;
  setCollectionFilter: (filter: string | null) => void;

  collectionLabCounts: Record<string, number>;
  collectionLabStateCounts: Record<string, Record<string, number>>;

  // Whether typing anywhere on the page goes into the search, e.g. while no lab is open
  typeToSearch: boolean;
}

const LabExplorer = (props: LabExplorerProps) => {
  const typingTimeoutRef = useRef<number | undefined>(undefined);
  const searchQueryFieldRef = useRef<HTMLInputElement>(null);

  const labStore = useLabStore();
  const collectionStore = useCollectionStore();

  useEffect(() => {
    if (searchQueryFieldRef.current && labStore.searchQuery === '') {
      searchQueryFieldRef.current.value = '';
    }
  }, [labStore.searchQuery]);

  useEffect(() => {
    if (!props.typeToSearch) return;

    function onKeyDown(event: KeyboardEvent) {
      const input = searchQueryFieldRef.current;
      if (!input || document.activeElement === input) return;

      // Only characters, no shortcuts
      if (
        event.key.length !== 1 ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      ) {
        return;
      }

      // Typing in other fields, dialogs and panels stays there
      const target = event.target as HTMLElement | null;
      if (
        target?.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        return;
      }
      if (document.querySelector('.p-dialog-mask, .p-overlaypanel')) return;

      // The character goes into the field that has the focus once the key is handled
      input.focus();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [props.typeToSearch]);

  function handleSearchChange(value: string) {
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = window.setTimeout(() => {
      labStore.setSearchQuery(value);
    }, 100);
  }

  return (
    <>
      <IconField iconPosition="left">
        <InputIcon className="pi pi-search" />
        <InputText
          ref={searchQueryFieldRef}
          className="width-100"
          placeholder="Search labs"
          onChange={e => handleSearchChange(e.target.value)}
        />
      </IconField>
      <a
        className={classNames('sb-lab-explorer-item', {
          selected: props.collectionFilter === null,
        })}
        onClick={() => props.setCollectionFilter(null)}
      >
        <span className="material-symbols-outlined">stacks</span>
        <span className="sb-lab-explorer-item-label">All labs</span>
        <span className="sb-lab-explorer-item-count">
          {labStore.data.length}
        </span>
      </a>
      <span className="sb-lab-explorer-title">Collections</span>
      {collectionStore.data.map((collection, i) => (
        <a
          key={i}
          className={classNames('sb-lab-explorer-item', {
            selected: props.collectionFilter === collection.id,
          })}
          onClick={() => props.setCollectionFilter(collection.id)}
        >
          <span className="material-symbols-outlined">inventory_2</span>
          <span className="sb-lab-explorer-item-label">{collection.name}</span>
          <div className="sb-lab-explorer-item-count">
            <div className="sb-lab-explorer-item-dots">
              {Object.keys(
                props.collectionLabStateCounts[collection.id] ?? {},
              ).map((state, i) => (
                <span key={i} className={`sb-lab-explorer-item-dot ${state}`} />
              ))}
            </div>
            <span className="sb-lab-explorer-item-count">
              {props.collectionLabCounts[collection.id] ?? 0}
            </span>
          </div>
        </a>
      ))}
    </>
  );
};

// An observer, so the search field is emptied when the search is cleared elsewhere
export default observer(LabExplorer);
