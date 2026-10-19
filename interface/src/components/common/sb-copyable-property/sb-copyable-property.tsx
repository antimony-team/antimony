import React from 'react';

const SBCopyableProperty = ({value}: {value: string}) => (
  <span
    className="copyable"
    data-pr-tooltip="Copy to clipboard"
    data-pr-position="right"
    data-pr-my="left+10 center"
    role="button"
    tabIndex={0}
    onClick={() => {
      void navigator.clipboard.writeText(value);
    }}
    onKeyDown={e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        void navigator.clipboard.writeText(value);
      }
    }}
  >
    {value}
  </span>
);

export default SBCopyableProperty;
