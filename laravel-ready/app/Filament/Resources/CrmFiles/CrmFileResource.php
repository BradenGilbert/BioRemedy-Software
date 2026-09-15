<?php

namespace App\Filament\Resources\CrmFiles;

use App\Filament\Resources\CrmFiles\Pages\ManageCrmFiles;
use App\Models\CrmFile;
use Filament\Forms\Components\KeyValue;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Form;
use Filament\Resources\Resource;
use Filament\Tables\Actions\BulkActionGroup;
use Filament\Tables\Actions\DeleteBulkAction;
use Filament\Tables\Actions\EditAction;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;

class CrmFileResource extends Resource
{
    protected static ?string $model = CrmFile::class;

    protected static ?string $recordTitleAttribute = 'url';

    public static function form(Form $form): Form
    {
        return $form->schema([
            Select::make('project_id')->relationship('project', 'name')->searchable()->preload(),
            Select::make('task_id')->relationship('task', 'title')->searchable()->preload(),
            Select::make('issue_id')->relationship('issue', 'title')->searchable()->preload(),
            TextInput::make('file_type')->maxLength(255),
            TextInput::make('url')->url()->columnSpanFull(),
            KeyValue::make('metadata')->columnSpanFull(),
        ]);
    }

    public static function table(Table $table): Table
    {
        return $table
            ->columns([
                TextColumn::make('project.name')->label('Project')->searchable()->sortable(),
                TextColumn::make('task.title')->label('Task')->searchable(),
                TextColumn::make('issue.title')->label('Issue')->searchable(),
                TextColumn::make('file_type')->searchable()->sortable(),
                TextColumn::make('url')->limit(50)->searchable(),
                TextColumn::make('created_at')->dateTime()->sortable(),
            ])
            ->filters([
                SelectFilter::make('file_type'),
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
            'index' => ManageCrmFiles::route('/'),
        ];
    }
}
