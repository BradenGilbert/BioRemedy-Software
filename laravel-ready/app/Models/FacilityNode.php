<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class FacilityNode extends Model
{
    use HasFactory;
    use HasUuids;
    use SoftDeletes;

    protected $guarded = [];

    public function facility(): BelongsTo
    {
        return $this->belongsTo(Facility::class);
    }

    public function parent(): BelongsTo
    {
        return $this->belongsTo(FacilityNode::class, 'parent_id');
    }

    public function children(): HasMany
    {
        return $this->hasMany(FacilityNode::class, 'parent_id');
    }

    public function jobSites(): HasMany
    {
        return $this->hasMany(JobSite::class);
    }
}
