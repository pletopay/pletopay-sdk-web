# @pletopay/react-native

## 1.0.0

### Security

- The WebView only navigates within the checkout origin. Links the page opens elsewhere (the merchant's support URL or `mailto:` address, or any redirect off the checkout origin) open in the system browser or mail app through `Linking.openURL`, never inside the view that carries the merchant's name. `javascript:` and other non-web schemes are dropped.


### Major Changes

- Initial release.
