<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Payment extends Model
{
    protected $fillable = ['order_id', 'method', 'amount', 'status', 'transaction_id', 'paid_at'];

    protected $casts = [
        'amount' => 'decimal:2',
        'paid_at' => 'datetime',
    ];

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    public function approve(string $transactionId): void
    {
        if ($this->status !== 'pending') {
            throw new \DomainException('Pagamento ja foi processado.');
        }
        $this->update([
            'status' => 'approved',
            'transaction_id' => $transactionId,
            'paid_at' => now(),
        ]);
    }

    public function reject(): void
    {
        if ($this->status !== 'pending') {
            throw new \DomainException('Pagamento ja foi processado.');
        }
        $this->update(['status' => 'rejected']);
    }
}
