<?php

namespace App\Services;

use App\Models\Product;
use Illuminate\Support\Collection;

class StockService
{
    public function getLowStockProducts(): Collection
    {
        return Product::where('active', true)
            ->whereColumn('stock', '<=', 'min_stock')
            ->with('category')
            ->get();
    }

    public function adjustStock(Product $product, int $quantity, string $reason = ''): Product
    {
        if ($quantity === 0) {
            throw new \DomainException('Quantidade de ajuste nao pode ser zero.');
        }

        $newStock = $product->stock + $quantity;
        if ($newStock < 0) {
            throw new \DomainException("Ajuste resultaria em estoque negativo ({$newStock}).");
        }

        $product->update(['stock' => $newStock]);
        return $product->fresh();
    }

    public function getStockValue(): float
    {
        return Product::where('active', true)
            ->selectRaw('SUM(stock * price) as total_value')
            ->value('total_value') ?? 0;
    }
}
