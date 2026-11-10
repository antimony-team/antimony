import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {
  BindFileDocument,
  CONTENT_FILE,
} from '@sb/lib/editor/document/bind-file-document';
import {FileEditSource} from '@sb/lib/editor/file-buffer';
import {Topology} from '@sb/types/domain/topology';

import {
  EditorTestBed,
  FakeTopologyStore,
  setUpEditorTest,
  tearDownEditorTest,
} from '../fakes';

let bed: EditorTestBed;
let topologyStore: FakeTopologyStore;

beforeEach(() => {
  bed = setUpEditorTest();
  ({topologyStore} = bed);
});

afterEach(tearDownEditorTest);

const addTopology = (topology?: Topology) => bed.addTopology(topology);
const addBindFile = (content?: string) => bed.addBindFile(content);

describe('BindFileDocument', () => {
  let doc: BindFileDocument;

  function buffer() {
    return doc.files[0].buffer!;
  }

  beforeEach(() => {
    addTopology();
    doc = bed.bindFileDocument(addBindFile());
  });

  it('opens a bind file with one file and no graph', () => {
    expect(doc.title).toBe('r1.cfg');
    expect(doc.subtitle).toBe('test');
    expect(doc.files.map(file => file.id)).toEqual([CONTENT_FILE]);
    expect(doc.graph).toBeNull();
    expect(doc.capabilities.views).toEqual(['code']);
    expect(doc.capabilities.deploy).toBe(false);
    expect(doc.isEdited).toBe(false);
  });

  it('marks the file as edited until its content is the saved one', () => {
    buffer().setText('hostname r2\n', FileEditSource.TextEditor);
    expect(doc.isEdited).toBe(true);

    buffer().setText('hostname r1\n', FileEditSource.TextEditor);
    expect(doc.isEdited).toBe(false);
  });

  it('undoes changes with the history of the document', () => {
    buffer().setText('hostname r2\n', FileEditSource.TextEditor);
    doc.undo();

    expect(buffer().text).toBe('hostname r1\n');
  });

  it('saves the file', async () => {
    buffer().setText('hostname r2\n', FileEditSource.TextEditor);
    await doc.save();

    expect(topologyStore.bindFileUpdates).toEqual([
      {id: 'file-id', content: 'hostname r2\n'},
    ]);
    expect(doc.isEdited).toBe(false);
  });

  it('keeps what is typed while the file is saved as unsaved', async () => {
    buffer().setText('hostname r2\n', FileEditSource.TextEditor);
    const saving = doc.save();
    buffer().setText('hostname r3\n', FileEditSource.TextEditor);
    await saving;

    expect(topologyStore.bindFileUpdates).toEqual([
      {id: 'file-id', content: 'hostname r2\n'},
    ]);
    expect(buffer().savedText).toBe('hostname r2\n');
    expect(doc.isEdited).toBe(true);
  });

  it('is read-only if the user can not edit its topology', () => {
    topologyStore.isEditable = false;
    const readOnly = bed.bindFileDocument(addBindFile());

    expect(readOnly.capabilities.readOnly).toBe(true);
  });
});
