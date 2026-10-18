import React, {useMemo} from 'react';

import classNames from 'classnames';

import {Button} from 'primereact/button';
import {Checkbox} from 'primereact/checkbox';
import {Message} from 'primereact/message';
import {Tooltip} from 'primereact/tooltip';

import SBDropdown from '@sb/components/common/sb-dropdown/sb-dropdown';
import SBInput from '@sb/components/common/sb-input/sb-input';
import NodePropertyArray from '@sb/components/editor-page/topology-editor/node-edit-dialog/node-property-table/node-property-array/node-property-array';
import {PropertyIO} from '@sb/lib/node-editor';
import {Choose, If, Otherwise, When} from '@sb/types/control';

interface NodePropertyTableRowProps {
  propertyKey: string;
  property: PropertyIO;

  showType?: boolean;
  isKeyEditable?: boolean;
}

const NodePropertyTableRow = (props: NodePropertyTableRowProps) => {
  const dropdownOptions = useMemo(
    () =>
      props.property.availableValues?.map(value => ({
        value,
      })) ?? null,
    [props.property],
  );

  const isInherited = props.property.value === undefined;
  const hasInheritedValue = props.property.inheritedValue !== undefined;

  // An inherited value is shown as the placeholder, so writing a value doesn't need clearing the field
  const placeholder =
    isInherited && hasInheritedValue
      ? `${String(props.property.inheritedValue)} (inherited)`
      : 'Empty';

  function onTextInputSubmit(value: string): string | null {
    if (props.property.type === 'number') {
      return props.property.onUpdateValue(Number(value));
    } else {
      return props.property.onUpdateValue(value);
    }
  }

  return (
    <tr>
      <td className="sb-property-table-key">
        <Choose>
          <When condition={props.property.wasAdded}>
            <Message className="sb-mini-message" severity="info" text="New" />
          </When>
          <When condition={props.property.wasEdited}>
            <Message
              className="sb-mini-message"
              severity="warn"
              text="Edited"
            />
          </When>
        </Choose>
        <Choose>
          <When condition={props.isKeyEditable && !isInherited}>
            <SBInput
              key={props.property.key}
              onValueSubmit={props.property.onUpdateKey}
              defaultValue={props.property.key}
              placeholder="Empty"
              ariaLabel="Key"
              isHidden={true}
              tooltip={props.property.description}
            />
          </When>
          <Otherwise>
            <span
              id={props.propertyKey}
              data-pr-tooltip={props.property.description}
              data-pr-position="right"
            >
              {props.propertyKey}
            </span>
            <Tooltip target={'#' + props.propertyKey} />
          </Otherwise>
        </Choose>
      </td>
      <td>
        <Choose>
          <When condition={dropdownOptions}>
            <SBDropdown
              value={(props.property.value as string | undefined) ?? null}
              placeholder={isInherited ? placeholder : undefined}
              options={dropdownOptions!}
              optionLabel="value"
              ariaLabel={props.propertyKey}
              isHidden={true}
              hasFilter={true}
              icon="pi-cog"
              useItemTemplate={true}
              onValueSubmit={props.property.onUpdateValue}
            />
          </When>
          <When condition={props.property.type === 'boolean'}>
            <Checkbox
              className={classNames({
                'sb-property-table-inherited': isInherited,
              })}
              onChange={e => props.property.onUpdateValue(e.checked!)}
              aria-label={props.propertyKey}
              checked={
                ((props.property.value ??
                  props.property.inheritedValue) as boolean) ?? false
              }
              tooltip={isInherited ? 'Inherited' : undefined}
              tooltipOptions={{showDelay: 500}}
            />
          </When>
          <When condition={props.property.isArray}>
            <NodePropertyArray
              entries={(props.property.value as string[] | undefined) ?? []}
              inheritedEntries={
                (props.property.inheritedValue as string[] | undefined) ?? []
              }
              onUpdateValue={props.property.onUpdateValue}
              minItems={props.property.minItems ?? 0}
              uniqueItems={props.property.uniqueItems}
            />
          </When>
          <Otherwise>
            <SBInput
              key={String(props.property.value)}
              onValueSubmit={onTextInputSubmit}
              defaultValue={
                isInherited ? '' : String(props.property.value as string)
              }
              placeholder={placeholder}
              ariaLabel={props.propertyKey}
              keyfilter={props.property.type === 'number' ? 'int' : undefined}
              isHidden={true}
            />
          </Otherwise>
        </Choose>
      </td>
      <If condition={props.showType}>
        <td className="sb-property-table-type">
          {dropdownOptions ? 'enum' : props.property.type}
        </td>
      </If>
      <td className="flex justify-content-center">
        <Choose>
          <When condition={isInherited}></When>
          <When condition={hasInheritedValue}>
            <Button
              icon="pi pi-undo"
              severity="secondary"
              rounded
              text
              onClick={props.property.onReset}
              tooltip="Reset to the inherited value"
              tooltipOptions={{showDelay: 500}}
              aria-label="Reset Property"
            />
          </When>
          <Otherwise>
            <Button
              icon="pi pi-trash"
              severity="danger"
              rounded
              text
              tooltip="Remove property"
              tooltipOptions={{showDelay: 500}}
              onClick={props.property.onReset}
              aria-label="Remove Property"
            />
          </Otherwise>
        </Choose>
      </td>
    </tr>
  );
};

export default NodePropertyTableRow;
