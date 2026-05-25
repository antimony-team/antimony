import React from 'react';

const SBCopyableProperty = ({value}: {value: string}) => (
  <span
    className="property-value copyable"
    data-pr-tooltip="Copy to clipboard"
    data-pr-position="right"
    data-pr-my="left+10 center"
    onClick={() => {
      void navigator.clipboard.writeText(value);
    }}
  >
    {value}
  </span>
);

export default SBCopyableProperty;
