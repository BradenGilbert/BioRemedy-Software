<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class CrewMember extends Model
{
    use HasFactory;
    use HasUuids;
    use SoftDeletes;

    public const UPDATED_AT = null;

    protected $guarded = [];

    public function crew(): BelongsTo
    {
        return $this->belongsTo(Crew::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
