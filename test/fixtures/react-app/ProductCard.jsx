import React from "react";

export default function ProductCard({ name, price, items, onBuy }) {
  return (
    <div className="card">
      <h3>{name}</h3>
      {price && (
        <p className="price">{price}</p>
      )}
      <ul>
        {items.map((item) => (
          <li key={item.id} onClick={() => onBuy(item)}>
            {item.label}
          </li>
        ))}
      </ul>
      <button onClick={() => onBuy(name)}>Buy</button>
    </div>
  );
}
