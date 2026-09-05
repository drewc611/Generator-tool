<!DOCTYPE html>
<html>
<head><title>{block name=title}Shop{/block}</title>
<style>{literal}.a { color: red; }{/literal}</style>
</head>
<body>
{include file='nav.tpl' active='shop'}
<main>{block name=content}<p>Layout default</p>{/block}</main>
<footer>{block name=footer}<small>All rights reserved.</small>{/block}</footer>
{literal}<script>var cfg = { a: 1 };</script>{/literal}
</body>
</html>
