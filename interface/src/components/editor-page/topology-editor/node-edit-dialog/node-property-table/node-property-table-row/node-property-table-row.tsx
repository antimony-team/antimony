import React, {useMemo} from 'react';

import {Button} from 'primereact/button';
import {Message} from 'primereact/message';
import {Tooltip} from 'primereact/tooltip';
import {Checkbox} from 'primereact/checkbox';

import {PropertyIO} from '@sb/lib/node-editor';
import {Choose, If, Otherwise, When} from '@sb/types/control';
import SBInput from '@sb/components/common/sb-input/sb-input';
import SBDropdown from '@sb/components/common/sb-dropdown/sb-dropdown';
import NodePropertyArray from '../node-property-array/node-property-array';

interface NodePropertyTableRowProps {
  propertyKey: string;
  property: PropertyIO;

  showType?: boolean;
  isKeyEditable?: boolean;
}

const NodePropertyTableRow: React.FC<NodePropertyTableRowProps> = (
  props: NodePropertyTableRowProps
) => {
  const dropdownOptions = useMemo(
    () =>
      props.property.availableValues?.map(value => ({
        value,
      })) ?? null,
    [props.property]
  );

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
          <When condition={props.isKeyEditable}>
            <SBInput
              key={props.property.key}
              onValueSubmit={props.property.onUpdateKey}
              defaultValue={props.property.key}
              placeholder="Empty"
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
              value={props.property.value as string}
              options={dropdownOptions!}
              optionLabel="value"
              isHidden={true}
              hasFilter={true}
              icon="pi-cog"
              useItemTemplate={true}
              onValueSubmit={props.property.onUpdateValue}
            />
          </When>
          <When condition={props.property.type === 'boolean'}>
            <Checkbox
              onChange={e => props.property.onUpdateValue(e.checked!)}
              checked={props.property.value as boolean}
            />
          </When>
          <When condition={props.property.isArray}>
            <NodePropertyArray
              entries={props.property.value as string[]}
              onUpdateValue={props.property.onUpdateValue}
              minItems={props.property.minItems ?? 0}
              uniqueItems={props.property.uniqueItems}
            />
          </When>
          <Otherwise>
            <SBInput
              key={props.property.value as string}
              onValueSubmit={onTextInputSubmit}
              defaultValue={props.property.value as string}
              placeholder="Empty"
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
        <Button
          icon="pi pi-undo"
          severity="secondary"
          rounded
          text
          onClick={props.property.onReset}
          tooltip="Revert property"
          tooltipOptions={{showDelay: 500}}
          disabled={!props.property.wasEdited}
          aria-label="Undo"
        />
        <Button
          icon="pi pi-trash"
          severity="danger"
          rounded
          text
          tooltip="Remove property"
          tooltipOptions={{showDelay: 500}}
          onClick={props.property.onDelete}
          aria-label="Redo"
        />
      </td>
    </tr>
  );
};

export default NodePropertyTableRow;
