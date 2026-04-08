<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Product extends Model
{
    protected $fillable = ['category_id', 'name', 'sku', 'description', 'price', 'stock', 'min_stock', 'active'];

    protected $casts = [
        'price' => 'decimal:2',
        'active' => 'boolean',
    ];

    public function category(): BelongsTo
    {
        return $this->belongsTo(Category::class);
    }

    public function orderItems(): HasMany
    {
        return $this->hasMany(OrderItem::class);
    }

    public function isLowStock(): bool
    {
        return $this->stock <= $this->min_stock;
    }

    public function hasStock(int $quantity): bool
    {
        return $this->stock >= $quantity;
    }

    public function decrementStock(int $quantity): void
    {
        if (!$this->hasStock($quantity)) {
            throw new \DomainException("Estoque insuficiente para {$this->name}. Disponivel: {$this->stock}, solicitado: {$quantity}");
        }
        $this->decrement('stock', $quantity);
    }

    public function incrementStock(int $quantity): void
    {
        $this->increment('stock', $quantity);
    }
}
