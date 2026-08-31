<template>
  <section class="orders">
    <h2>Orders for {{ region }}</h2>
    <input v-model="query" :placeholder="'Filter ' + region" />
    <p v-if="loading">Loading orders</p>
    <p v-else-if="error" class="err">{{ error }}</p>
    <table v-else>
      <tr v-for="(o, i) in orders" :key="o.id" @click="select(o)">
        <td>{{ o.reference }}</td>
        <td>{{ o.customer }}</td>
        <td>{{ i }}</td>
      </tr>
    </table>
    <slot></slot>
  </section>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import axios from 'axios';

const props = defineProps({ region: String, pageSize: Number });
const emit = defineEmits(['selected']);

const orders = ref([]);
const query = ref('');
const loading = ref(false);
const error = ref(null);

async function load() {
  loading.value = true;
  const res = await fetch('/api/v2/orders');
  orders.value = await res.json();
  loading.value = false;
}

async function create(body) {
  await axios.post('/api/v2/orders', body);
}

function select(order) { emit('selected', order); }

onMounted(load);
watch(query, load);
</script>

<style scoped>
.orders { font-family: 'Proxima Nova', Arial, sans-serif; color: #1b1f24; }
.err { color: #a3231f; }
</style>
