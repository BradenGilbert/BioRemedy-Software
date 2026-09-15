<?php

namespace App\Filament\Resources\JobSites;

use App\Filament\Resources\JobSites\Pages\ManageJobSites;
use App\Models\JobSite;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Components\Textarea;
use Filament\Forms\Components\Toggle;
use Filament\Forms\Form;
use Filament\Resources\Resource;
use Filament\Tables\Actions\BulkActionGroup;
use Filament\Tables\Actions\DeleteBulkAction;
use Filament\Tables\Actions\EditAction;
use Filament\Tables\Columns\IconColumn;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;

class JobSiteResource extends Resource
{
    protected static ?string $model = JobSite::class;

    protected static ?string $recordTitleAttribute = 'name';

    public static function form(Form $form): Form
    {
        return $form->schema([
            Select::make('account_id')->relationship('account', 'name')->searchable()->preload(),
            Select::make('facility_id')->relationship('facility', 'name')->searchable()->preload(),
            Select::make('facility_node_id')->relationship('facilityNode', 'name')->searchable()->preload(),
            TextInput::make('name')->maxLength(255),
            TextInput::make('site_type')->required()->maxLength(255),
            Textarea::make('description')->columnSpanFull(),
            TextInput::make('latitude')->numeric(),
            TextInput::make('longitude')->numeric(),
            TextInput::make('linear_reference')->columnSpanFull(),
            Toggle::make('is_temporary')->default(true),
        ]);
    }

    public static function table(Table $table): Table
    {
        return $table
            ->columns([
                TextColumn::make('account.name')->label('Account')->searchable()->sortable(),
                TextColumn::make('facility.name')->label('Facility')->searchable()->sortable(),
                TextColumn::make('name')->searchable()->sortable(),
                TextColumn::make('site_type')->searchable()->sortable(),
                IconColumn::make('is_temporary')->boolean(),
            ])
            ->filters([
                SelectFilter::make('site_type'),
            ])
            ->actions([
                EditAction::make(),
            ])
            ->bulkActions([
                BulkActionGroup::make([
                    DeleteBulkAction::make(),
                ]),
            ]);
    }

    public static function getPages(): array
    {
        return [
            'index' => ManageJobSites::route('/'),
        ];
    }
}
