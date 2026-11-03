// A WebView double: renders nothing native and exposes its props to the tests through a registry.
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories must require lazily */
jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  const registry: { current: Record<string, unknown> | null } = { current: null };
  const WebView = (props: Record<string, unknown>) => {
    registry.current = props;
    return React.createElement(View, { testID: props.testID });
  };
  return { WebView, __registry: registry, default: WebView };
});
