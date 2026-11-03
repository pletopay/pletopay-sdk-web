<script setup lang="ts">
const { publicKey, status } = usePletopay();
const { state } = usePletopayCheckout();
</script>

<template>
  <div>
    <p id="key">{{ publicKey }}</p>
    <p id="status">{{ status }}</p>
    <p id="checkout">{{ state.status }}</p>
    <PletopayCheckoutButton id="pay" session="tok_fixture">Pay with bank transfer</PletopayCheckoutButton>
  </div>
</template>
