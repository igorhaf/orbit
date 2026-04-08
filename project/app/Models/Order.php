<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Order extends Model
{
    protected $fillable = ['customer_id', 'number', 'status', 'subtotal', 'discount', 'total', 'notes', 'confirmed_at', 'shipped_at', 'delivered_at'];

    protected $casts = [
        'subtotal' => 'decimal:2',
        'discount' => 'decimal:2',
        'total' => 'decimal:2',
        'confirmed_at' => 'datetime',
        'shipped_at' => 'datetime',
        'delivered_at' => 'datetime',
    ];

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }

    public function items(): HasMany
    {
        return $this->hasMany(OrderItem::class);
    }

    public function payment(): HasOne
    {
        return $this->hasOne(Payment::class);
    }

    public function recalculateTotals(): void
    {
        $this->subtotal = $this->items()->sum('total');
        $this->total = $this->subtotal - $this->discount;
        $this->save();
    }

    public function canBeConfirmed(): bool
    {
        return $this->status === 'draft' && $this->items()->count() > 0;
    }

    public function canBeCancelled(): bool
    {
        return in_array($this->status, ['draft', 'confirmed']);
    }

    public function confirm(): void
    {
        if (!$this->canBeConfirmed()) {
            throw new \DomainException('Pedido nao pode ser confirmado. Verifique se possui itens e esta em rascunho.');
        }
        $this->update(['status' => 'confirmed', 'confirmed_at' => now()]);
    }

    public function cancel(): void
    {
        if (!$this->canBeCancelled()) {
            throw new \DomainException('Pedido nao pode ser cancelado neste status.');
        }
        // Restore stock for all items
        foreach ($this->items as $item) {
            $item->product->incrementStock($item->quantity);
        }
        $this->update(['status' => 'cancelled']);
    }

    public function markShipped(): void
    {
        if ($this->status !== 'confirmed') {
            throw new \DomainException('Apenas pedidos confirmados podem ser enviados.');
        }
        $this->update(['status' => 'shipped', 'shipped_at' => now()]);
    }

    public function markDelivered(): void
    {
        if ($this->status !== 'shipped') {
            throw new \DomainException('Apenas pedidos enviados podem ser marcados como entregues.');
        }
        $this->update(['status' => 'delivered', 'delivered_at' => now()]);
    }

    public static function generateNumber(): string
    {
        return 'PED-' . date('Ymd') . '-' . str_pad(static::whereDate('created_at', today())->count() + 1, 4, '0', STR_PAD_LEFT);
    }
}
