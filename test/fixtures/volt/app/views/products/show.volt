{% cache "product" %}
<h1>{{ product.name }}</h1>
<img src="{{ static_url('img/logo.png') }}" alt="">
{% if product.stock == 0 %}<p class="out">Sold out</p>{% elseif product.stock < 5 %}<p class="low">Only {{ product.stock }} left</p>{% else %}<p>In stock</p>{% endif %}
<ul>{% for tag in product.tags %}{% if tag is empty %}{% continue %}{% endif %}<li>{{ tag }}</li>{% endfor %}</ul>
{% do product.touch() %}
<form method="post" action="{{ url('orders/create') }}">
  {{ tag.textField(['quantity', 'class': 'qty']) }}
  {{ tag.select('size') }}
  {{ tag.submitButton('Buy') }}
</form>
{% endcache %}
