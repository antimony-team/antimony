import React, {
  MouseEvent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {Button} from 'primereact/button';
import {IconField} from 'primereact/iconfield';
import {InputIcon} from 'primereact/inputicon';
import {InputText} from 'primereact/inputtext';
import {ListBox} from 'primereact/listbox';
import {OverlayPanel} from 'primereact/overlaypanel';
import {SelectItem} from 'primereact/selectitem';

import {NodeEditor} from '@sb/lib/node-editor';
import {useReturnFocus} from '@sb/lib/utils/hooks';
import {matchesSearch} from '@sb/lib/utils/utils';
import {If} from '@sb/types/control';

import NodePropertyTableRow from './node-property-table-row/node-property-table-row';

import './node-property-table.sass';

type OptionGroupOptions = {
  optionGroup: {
    value: string;
  };
};

interface NodePropertyTableProps {
  nodeEditor: NodeEditor;

  objectKey: string;
  schemaKey: string;

  hideType?: boolean;
  isKeyEditable?: boolean;

  keyHeader?: string;
  valueHeader?: string;
  addText?: string;
}

const NodePropertyTable = (props: NodePropertyTableProps) => {
  // List of available properties or null, if property does not have any restrictions.
  const [availableProperties, setAvailableProperties] = useState<
    SelectItem[] | null
  >([]);
  const [propertyQuery, setPropertyQuery] = useState('');
  const [propertyTable, setPropertyTable] = useState<ReactElement[]>([]);

  const newPropertyOverlayRef = useRef<OverlayPanel>(null);
  const newPropertyInputRef = useRef<HTMLInputElement>(null);
  const newPropertyReturnFocus = useReturnFocus();

  const availablePropertiesFiltered: SelectItem[] | null = useMemo(() => {
    if (!availableProperties) return null;
    if (!propertyQuery) return availableProperties;

    return availableProperties.filter(property =>
      matchesSearch(property.value!, propertyQuery),
    );
  }, [availableProperties, propertyQuery]);

  const onTopologyUpdate = useCallback(() => {
    setPropertyTable([
      ...props.nodeEditor
        .getObjectProperties(props.objectKey, props.schemaKey)
        .entries()
        .map(([index, property]) => (
          <NodePropertyTableRow
            key={index}
            property={property}
            propertyKey={property.key}
            showType={props.hideType}
            isKeyEditable={props.isKeyEditable}
          />
        )),
    ]);

    setAvailableProperties(
      props.nodeEditor
        .getAvailableProperties(props.objectKey, props.schemaKey)
        ?.map(property => ({
          value: property,
        })) ?? null,
    );
  }, [
    props.isKeyEditable,
    props.nodeEditor,
    props.objectKey,
    props.schemaKey,
    props.hideType,
  ]);

  useEffect(() => {
    props.nodeEditor.onEdit.register(onTopologyUpdate);
    onTopologyUpdate();

    return () => props.nodeEditor.onEdit.unregister(onTopologyUpdate);
  }, [props.nodeEditor, onTopologyUpdate]);

  function onAddPropertyClicked(event: MouseEvent<HTMLButtonElement>) {
    if (!newPropertyOverlayRef) return;

    // If an object does not have a property list, add new empy property directly
    if (availableProperties === null) {
      onAddProperty('');
      return;
    }

    setPropertyQuery('');
    if (newPropertyOverlayRef.current?.isVisible()) {
      newPropertyOverlayRef.current?.hide();
    } else {
      newPropertyOverlayRef.current?.show(event, event.target);
      newPropertyInputRef.current?.focus();
    }
  }

  function onAddProperty(key: string) {
    props.nodeEditor.addProperty(key, props.objectKey, props.schemaKey);
    newPropertyOverlayRef.current?.hide();
  }

  const propertyListTemplate = (option: OptionGroupOptions) => {
    return (
      <div
        className="flex align-items-center gap-3"
        role="button"
        tabIndex={0}
        onClick={() => onAddProperty(option.optionGroup.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onAddProperty(option.optionGroup.value);
          }
        }}
      >
        <i className="pi pi-wrench"></i>
        <span>{option.optionGroup.value}</span>
      </div>
    );
  };

  return (
    <>
      <If condition={propertyTable.length > 0}>
        <table className="sb-table sb-property-table">
          <thead>
            <tr>
              <th scope="col" className="sb-property-table-key">
                {props.keyHeader ?? 'Property'}
              </th>
              <th scope="col" className="sb-property-table-value">
                {props.valueHeader ?? 'Value'}
              </th>
              <If condition={props.hideType}>
                <th scope="col" className="sb-property-table-type">
                  Type
                </th>
              </If>
              <td className="sb-property-table-actions"></td>
            </tr>
          </thead>
          <tbody>{propertyTable}</tbody>
        </table>
      </If>

      <div className="flex justify-content-center">
        <If
          condition={
            availableProperties === null || availableProperties.length > 0
          }
        >
          <Button
            label={props.addText ?? 'Add property'}
            icon="pi pi-plus"
            className="sb-property-table-add-button"
            onClick={onAddPropertyClicked}
            outlined
            aria-label={props.addText ?? 'Add property'}
          />
        </If>
        <If condition={availableProperties}>
          <OverlayPanel
            ref={newPropertyOverlayRef}
            className="sb-node-new-property-overlay"
            onShow={() => {
              newPropertyReturnFocus.onShow();
              newPropertyInputRef.current?.focus();
            }}
            onHide={() =>
              newPropertyReturnFocus.onHide(
                newPropertyOverlayRef.current?.getElement(),
              )
            }
          >
            <IconField iconPosition="left">
              <InputIcon className="pi pi-search"></InputIcon>
              <InputText
                pt={{
                  root: {
                    ref: newPropertyInputRef,
                  },
                }}
                placeholder="Search"
                aria-label="Search properties"
                value={propertyQuery}
                onChange={e => setPropertyQuery(e.target.value)}
              />
            </IconField>
            <ListBox
              options={availablePropertiesFiltered!}
              className="w-full md:w-14rem"
              emptyMessage="No matching properties found"
              optionGroupLabel="value"
              optionGroupTemplate={propertyListTemplate}
            />
          </OverlayPanel>
        </If>
      </div>
    </>
  );
};

export default NodePropertyTable;
