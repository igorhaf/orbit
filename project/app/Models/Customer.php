<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Customer extends Model
{
    protected $fillable = ['name', 'email', 'phone', 'document', 'type', 'address', 'active'];

    protected $casts = [
        'active' => 'boolean',
    ];

    public function orders(): HasMany
    {
        return $this->hasMany(Order::class);
    }

    public function isCompany(): bool
    {
        return $this->type === 'company';
    }
}
