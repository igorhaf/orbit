<?php

namespace Database\Seeders;

use App\Models\Category;
use App\Models\Customer;
use App\Models\Product;
use Illuminate\Database\Seeder;

class DemoSeeder extends Seeder
{
    public function run(): void
    {
        // Customers
        Customer::create(['name' => 'Maria Silva', 'email' => 'maria@email.com', 'document' => '123.456.789-00', 'type' => 'individual', 'phone' => '(11) 99999-1111']);
        Customer::create(['name' => 'Tech Solutions Ltda', 'email' => 'contato@techsolutions.com', 'document' => '12.345.678/0001-90', 'type' => 'company', 'phone' => '(11) 3333-4444']);
        Customer::create(['name' => 'Joao Santos', 'email' => 'joao@email.com', 'document' => '987.654.321-00', 'type' => 'individual']);

        // Categories
        $eletronicos = Category::create(['name' => 'Eletronicos', 'slug' => 'eletronicos', 'description' => 'Dispositivos e acessorios eletronicos']);
        $moveis = Category::create(['name' => 'Moveis', 'slug' => 'moveis', 'description' => 'Moveis para escritorio e casa']);
        $papelaria = Category::create(['name' => 'Papelaria', 'slug' => 'papelaria', 'description' => 'Material de escritorio e papelaria']);

        // Products
        Product::create(['category_id' => $eletronicos->id, 'name' => 'Monitor 24" Full HD', 'sku' => 'MON-24-FHD', 'price' => 899.90, 'stock' => 15, 'min_stock' => 5]);
        Product::create(['category_id' => $eletronicos->id, 'name' => 'Teclado Mecanico RGB', 'sku' => 'TEC-MEC-RGB', 'price' => 349.90, 'stock' => 30, 'min_stock' => 10]);
        Product::create(['category_id' => $eletronicos->id, 'name' => 'Mouse Wireless', 'sku' => 'MOU-WIR-01', 'price' => 129.90, 'stock' => 50, 'min_stock' => 15]);
        Product::create(['category_id' => $moveis->id, 'name' => 'Cadeira Ergonomica', 'sku' => 'CAD-ERG-01', 'price' => 1299.90, 'stock' => 8, 'min_stock' => 3]);
        Product::create(['category_id' => $moveis->id, 'name' => 'Mesa Escritorio 1.40m', 'sku' => 'MES-ESC-140', 'price' => 699.90, 'stock' => 12, 'min_stock' => 4]);
        Product::create(['category_id' => $papelaria->id, 'name' => 'Resma Papel A4 500 folhas', 'sku' => 'PAP-A4-500', 'price' => 29.90, 'stock' => 200, 'min_stock' => 50]);
        Product::create(['category_id' => $papelaria->id, 'name' => 'Caneta Esferografica Azul cx12', 'sku' => 'CAN-ESF-AZ12', 'price' => 15.90, 'stock' => 3, 'min_stock' => 20, 'description' => 'Caixa com 12 canetas esferograficas azuis']);
    }
}
