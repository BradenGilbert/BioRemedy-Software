<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('equipment', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->text('name')->nullable();
            $table->text('type')->nullable();
            $table->text('serial_number')->nullable();
            $table->text('status')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index('type', 'idx_equipment_type');
            $table->index('status', 'idx_equipment_status');
            $table->index('serial_number', 'idx_equipment_serial');
            $table->index('deleted_at', 'idx_equipment_deleted_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('equipment');
    }
};
