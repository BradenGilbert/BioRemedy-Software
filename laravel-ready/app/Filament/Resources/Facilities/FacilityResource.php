<?php

namespace App\Filament\Resources\Facilities;

use App\Filament\Resources\Facilities\Pages\ManageFacilities;
use App\Models\Facility;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Components\Textarea;
use Filament\Forms\Form;
use Filament\Resources\Resource;
use Filament\Tables\Actions\BulkActionGroup;
use Filament\Tables\Actions\DeleteBulkAction;
use Filament\Tables\Actions\EditAction;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;

class FacilityResource extends Resource
{
    protected static ?string $model = Facility::class;

    protected static ?string $recordTitleAttribute = 'name';

    public static function form(Form $form): Form
    {
        return $form->schema([
            Select::make('account_id')->relationship('account', 'name')->searchable()->preload(),
            TextInput::make('name')->required()->maxLength(255),
            TextInput::make('facility_type')->required()->maxLength(255),
            TextInput::make('address')->columnSpanFull(),
            TextInput::make('city')->maxLength(255),
            TextInput::make('state')->maxLength(255),
            TextInput::make('postal_code')->maxLength(255),
            TextInput::make('latitude')->numeric(),
            TextInput::make('longitude')->numeric(),
            Textarea::make('notes')->columnSpanFull(),
        ]);
    }

    public static function table(Table $table): Table
    {
        return $table
            ->columns([
                TextColumn::make('account.name')->label('Account')->searchable()->sortable(),
                TextColumn::make('name')->searchable()->sortable(),
                TextColumn::make('facility_type')->searchable()->sortable(),
                TextColumn::make('city')->searchable()->sortable(),
                TextColumn::make('state')->searchable()->sortable(),
            ])
            ->filters([
                SelectFilter::make('facility_type'),
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
            'index' => ManageFacilities::route('/'),
        ];
    }
}
